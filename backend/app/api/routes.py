from fastapi import APIRouter, HTTPException, Query
from app.services.stock_service import get_dashboard_data, update_all_stocks, load_stocks_json, fetch_missing_klines, fetch_logos_from_tradingview
from app.services.institutional_service import get_institutional_data
from app.services import institutional_service, setup_progress
from app.services.news_service import get_news, get_aggregated_feed, refresh_all_news, get_capacity_analysis, refresh_one_stalest
from app.services import kol_service
from app.services import fb_service
from app.services.youtube_service import get_mentions, run_youtube_pipeline
from app.services import business_cycle_service
from app.services import indices_service
from app.database import get_connection
from datetime import datetime, timezone
from pydantic import BaseModel
import json
import logging
import os
import threading
from pathlib import Path

router = APIRouter(prefix="/api")
logger = logging.getLogger(__name__)

# Pipeline background state
_pipeline_lock = threading.Lock()
_pipeline_running = False
_pipeline_started_at: str | None = None
_pipeline_last_result: dict | None = None

# News-refresh background state (single-flight lock — prevents overlapping
# scrapes when the frontend autopoll fires faster than a scrape completes)
_news_refresh_lock = threading.Lock()
_news_refresh_running = False
_news_refresh_started_at: str | None = None
_news_refresh_last_result: dict | None = None

# KOL refresh background state
_kol_refresh_lock = threading.Lock()
_kol_refresh_running = False
_kol_refresh_started_at: str | None = None
_kol_refresh_last_result: dict | None = None

# NotebookLM browser-login background state
_nblm_login_lock = threading.Lock()
_nblm_login_running = False
_nblm_login_started_at: str | None = None
_nblm_login_last_result: dict | None = None

# Facebook refresh + login background state
_fb_refresh_lock = threading.Lock()
_fb_refresh_running = False
_fb_refresh_started_at: str | None = None
_fb_refresh_last_result: dict | None = None
_fb_login_lock = threading.Lock()
_fb_login_running = False
_fb_login_started_at: str | None = None
_fb_login_last_result: dict | None = None

_SETTINGS_KEYS = {"YOUTUBE_API_KEY", "GEMINI_API_KEY", "YOUTUBE_CHANNEL_ID", "GEMINI_MODEL", "FINMIND_TOKEN"}


class SettingsPayload(BaseModel):
    YOUTUBE_API_KEY: str = ""
    GEMINI_API_KEY: str = ""
    YOUTUBE_CHANNEL_ID: str = ""
    GEMINI_MODEL: str = ""
    FINMIND_TOKEN: str = ""


def _mask(key: str) -> str:
    """Mask with a fixed 8-asterisk middle so long JWT tokens don't overflow UI."""
    if not key:
        return ""
    if len(key) <= 8:
        return "*" * len(key)
    return key[:4] + "********" + key[-4:]


@router.get("/stocks")
def list_stocks(
    include_disabled: bool = Query(default=True),
    market: str | None = Query(default=None, description="TW or US; omit for all"),
):
    """List stocks with management-relevant fields.

    `market` filters by TW or US. Settings UI passes it to page between
    the per-market stock managers.
    """
    conn = get_connection()
    try:
        sql = ("SELECT symbol, name, market, exchange, layer, layer_name, sub_category, note, "
               "theme, themes, tier, enabled, created_at, updated_at FROM stocks")
        where: list[str] = []
        params: list = []
        if not include_disabled:
            where.append("enabled = 1")
        if market:
            where.append("market = ?")
            params.append(market.upper())
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY theme, layer, symbol"
        rows = conn.execute(sql, params).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["enabled"] = bool(d.get("enabled", 1))
            if d.get("themes"):
                try:
                    d["themes"] = json.loads(d["themes"])
                except Exception:
                    pass
            out.append(d)
        return out
    finally:
        conn.close()


class StockPayload(BaseModel):
    symbol: str
    name: str
    layer: int = 0
    layer_name: str | None = None  # auto-filled from layer mapping if blank
    sub_category: str | None = None
    note: str | None = None
    theme: str = "A"
    tier: int = 2
    enabled: bool = True
    secondary_layers: list[int] | None = None
    market: str = "TW"
    exchange: str | None = None


# Canonical layer → (display num, name, theme) — mirrors frontend LAYER_META
_LAYER_META = {
    1: ("晶片設計與製造", "A"), 2: ("化合物半導體", "A"), 3: ("記憶體", "A"),
    4: ("PCB 載板", "A"), 5: ("PCB 主機板", "A"), 6: ("散熱電源", "A"),
    7: ("光通訊 CPO", "A"), 8: ("被動元件", "A"), 9: ("ODM 組裝", "A"),
    10: ("電力基礎建設", "A"),
    16: ("半導體設備與精密零組件", "A"), 17: ("特用化學材料", "A"),
    18: ("機殼滑軌結構件", "A"), 19: ("測試封測介面", "A"),
    25: ("連接器與線材", "A"), 26: ("工業電腦邊緣 AI", "A"),
    11: ("電池材料", "B"), 12: ("三電傳動", "B"), 13: ("車用線束", "B"),
    14: ("車燈光學", "B"), 15: ("充電基建", "B"),
    21: ("減速機傳動", "C"), 22: ("伺服馬達", "C"),
    23: ("機電整合", "C"), 24: ("感測末端", "C"),
}


def _resolve_layer(p: StockPayload) -> tuple[str, str]:
    """Return (layer_name, theme) — fills from LAYER_META when payload omits."""
    meta = _LAYER_META.get(p.layer)
    layer_name = p.layer_name or (meta[0] if meta else f"Layer {p.layer}")
    theme = p.theme or (meta[1] if meta else "A")
    return layer_name, theme


@router.post("/stocks", status_code=201)
def create_stock(payload: StockPayload):
    """
    Add a new stock. Layer info auto-filled from canonical meta if client
    omits layer_name/theme. Kicks off background kline + EPS fetch for the
    new symbol so data shows up in the dashboard without a server restart.
    """
    from app.services.stock_service import fetch_yfinance, upsert_klines, upsert_metadata
    layer_name, theme = _resolve_layer(payload)
    now = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        existing = conn.execute("SELECT symbol FROM stocks WHERE symbol = ?", (payload.symbol,)).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail=f"Stock {payload.symbol} already exists")
        conn.execute(
            """INSERT INTO stocks
               (symbol, name, market, exchange, layer, layer_name, sub_category, note,
                theme, themes, secondary_layers, tier, enabled, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (payload.symbol, payload.name,
             (payload.market or "TW").upper(), payload.exchange,
             payload.layer, layer_name,
             payload.sub_category, payload.note, theme, None,
             json.dumps(payload.secondary_layers) if payload.secondary_layers else None,
             payload.tier, 1 if payload.enabled else 0, now, now),
        )
        conn.commit()
    finally:
        conn.close()

    # Background fetch: klines + metadata (tolerant of failures)
    def _fetch_bg():
        try:
            df, info = fetch_yfinance(payload.symbol, "5y", market=(payload.market or "TW").upper())
            if df is not None and not df.empty:
                upsert_klines(payload.symbol, df)
                if info:
                    upsert_metadata(payload.symbol, info)
        except Exception as e:
            logger.error(f"create_stock bg fetch {payload.symbol}: {e}")

    threading.Thread(target=_fetch_bg, daemon=True).start()
    return {"status": "ok", "symbol": payload.symbol, "layer_name": layer_name, "theme": theme}


@router.put("/stocks/{symbol}")
def update_stock(symbol: str, payload: StockPayload):
    """Edit an existing stock's metadata (no data refetch)."""
    if payload.symbol != symbol:
        raise HTTPException(status_code=400, detail="Path symbol does not match payload symbol")
    layer_name, theme = _resolve_layer(payload)
    now = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        res = conn.execute(
            """UPDATE stocks SET
                 name=?, layer=?, layer_name=?, sub_category=?, note=?, theme=?,
                 secondary_layers=?, tier=?, enabled=?, updated_at=?
               WHERE symbol=?""",
            (payload.name, payload.layer, layer_name, payload.sub_category,
             payload.note, theme,
             json.dumps(payload.secondary_layers) if payload.secondary_layers else None,
             payload.tier, 1 if payload.enabled else 0, now, symbol),
        )
        conn.commit()
        if res.rowcount == 0:
            raise HTTPException(status_code=404, detail="Stock not found")
    finally:
        conn.close()
    return {"status": "ok", "symbol": symbol}


@router.patch("/stocks/{symbol}/enabled")
def set_stock_enabled(symbol: str, enabled: bool = Query(...)):
    """Toggle only the enabled flag — the dashboard hides disabled stocks."""
    conn = get_connection()
    try:
        res = conn.execute(
            "UPDATE stocks SET enabled=?, updated_at=? WHERE symbol=?",
            (1 if enabled else 0, datetime.now(timezone.utc).isoformat(), symbol),
        )
        conn.commit()
        if res.rowcount == 0:
            raise HTTPException(status_code=404, detail="Stock not found")
    finally:
        conn.close()
    return {"status": "ok", "symbol": symbol, "enabled": enabled}


@router.delete("/stocks/{symbol}")
def delete_stock(symbol: str):
    """Hard-delete a stock and all its related data (klines, metadata, caches)."""
    conn = get_connection()
    try:
        res = conn.execute("DELETE FROM stocks WHERE symbol=?", (symbol,))
        conn.execute("DELETE FROM klines WHERE symbol=?", (symbol,))
        conn.execute("DELETE FROM metadata WHERE symbol=?", (symbol,))
        conn.execute("DELETE FROM news_cache WHERE symbol=?", (symbol,))
        conn.execute("DELETE FROM eps_annual WHERE symbol=?", (symbol,))
        conn.execute("DELETE FROM eps_quarterly WHERE symbol=?", (symbol,))
        conn.commit()
        if res.rowcount == 0:
            raise HTTPException(status_code=404, detail="Stock not found")
    finally:
        conn.close()
    return {"status": "ok", "symbol": symbol}


@router.get("/stocks/{symbol}")
def get_stock(symbol: str):
    conn = get_connection()
    try:
        stock = conn.execute("SELECT * FROM stocks WHERE symbol = ?", (symbol,)).fetchone()
        if not stock:
            raise HTTPException(status_code=404, detail="Stock not found")

        kline_rows = conn.execute(
            """SELECT date, open, high, low, close, volume FROM klines
               WHERE symbol = ? ORDER BY date DESC LIMIT 240""",
            (symbol,)
        ).fetchall()
        klines = list(reversed([dict(r) for r in kline_rows]))

        meta = conn.execute("SELECT * FROM metadata WHERE symbol = ?", (symbol,)).fetchone()

        closes = [k["close"] for k in klines]
        ma_values = {}
        for p in [5, 10, 20, 60, 120, 240]:
            if len(closes) >= p:
                ma_values[str(p)] = round(sum(closes[-p:]) / p, 2)
            else:
                ma_values[str(p)] = None

        return {
            **dict(stock),
            "ma": ma_values,
            "klines": klines[-60:],
            "pe_ratio": dict(meta)["pe_ratio"] if meta else None,
            "market_cap": dict(meta)["market_cap"] if meta else None,
        }
    finally:
        conn.close()


@router.get("/stocks/{symbol}/klines")
def get_klines(symbol: str, days: int = Query(default=1300, ge=1, le=1300)):
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT date, open, high, low, close, volume FROM klines
               WHERE symbol = ? ORDER BY date DESC LIMIT ?""",
            (symbol, days)
        ).fetchall()
        return list(reversed([dict(r) for r in rows]))
    finally:
        conn.close()


# ── Intraday 1-minute bars (used by the 覆盤 / replay UI) ──────────────────

@router.get("/stocks/{symbol}/intraday")
def get_stock_intraday(
    symbol: str,
    date: str | None = Query(default=None, description="YYYY-MM-DD; omit for latest"),
    interval: str = Query(default="1m", description="1m / 5m / 15m / 30m / 60m"),
):
    """Return one trading day's bars for the symbol at the given interval.

    Source: yfinance free intraday endpoints. Each (symbol, date, interval)
    bundle is cached after the first fetch so the replay UI can scrub /
    restart / switch interval without re-hitting yfinance.
    """
    from app.services import intraday_service

    if interval not in intraday_service.SUPPORTED_INTERVALS:
        raise HTTPException(status_code=400, detail=f"unsupported interval {interval}")

    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT market FROM stocks WHERE symbol = ?", (symbol,)
        ).fetchone()
    finally:
        conn.close()
    market = (row["market"] if row else "TW") or "TW"

    try:
        return intraday_service.get_intraday_bars(symbol, market, date, interval)
    except Exception as e:
        logger.error(f"intraday {symbol} {date} {interval}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stocks/{symbol}/intraday/dates")
def get_stock_intraday_dates(
    symbol: str,
    interval: str = Query(default="1m", description="1m / 5m / 15m / 30m / 60m"),
):
    """List up to 14 recent trading dates with data at this interval
    (yfinance keeps 7d for 1m, 60d for the rest; cache merged in)."""
    from app.services import intraday_service

    if interval not in intraday_service.SUPPORTED_INTERVALS:
        raise HTTPException(status_code=400, detail=f"unsupported interval {interval}")

    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT market FROM stocks WHERE symbol = ?", (symbol,)
        ).fetchone()
    finally:
        conn.close()
    market = (row["market"] if row else "TW") or "TW"

    try:
        return {"dates": intraday_service.list_available_dates(symbol, market, interval)}
    except Exception as e:
        logger.error(f"intraday dates {symbol} {interval}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/dashboard")
def get_dashboard(market: str = Query(default="TW", description="TW or US")):
    try:
        return get_dashboard_data(market=market.upper())
    except Exception as e:
        logger.error(f"Dashboard error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/indices")
def get_indices(days: int = Query(default=90, ge=20, le=1300)):
    """Market indices widget data — TAIEX, SOX, Dow, NASDAQ, etc."""
    return {"indices": indices_service.get_indices_data(days=days)}


@router.post("/indices/refresh")
def post_indices_refresh():
    """Manually re-fetch all indices from yfinance."""
    return indices_service.refresh_all_indices()


@router.post("/refresh")
def refresh_data(full: bool = False):
    """
    full=false (default): fetch last 5d (daily update)
    full=true: re-fetch 5y for all stocks
    """
    try:
        result = update_all_stocks(period="5y" if full else "5d")
        return {"status": "ok", **result}
    except Exception as e:
        logger.error(f"Refresh error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/cleanup-orphans")
def cleanup_orphans():
    """Remove stocks from DB that are no longer in stocks.json (e.g. fixed typos)."""
    current = {s["symbol"] for s in load_stocks_json("TW") + load_stocks_json("US")}
    conn = get_connection()
    try:
        db_syms = {row[0] for row in conn.execute("SELECT symbol FROM stocks").fetchall()}
        orphans = db_syms - current
        for sym in orphans:
            conn.execute("DELETE FROM stocks WHERE symbol=?", (sym,))
            conn.execute("DELETE FROM klines WHERE symbol=?", (sym,))
            conn.execute("DELETE FROM metadata WHERE symbol=?", (sym,))
            conn.execute("DELETE FROM eps_annual WHERE symbol=?", (sym,))
            conn.execute("DELETE FROM eps_quarterly WHERE symbol=?", (sym,))
        conn.commit()
        return {"status": "ok", "removed": sorted(orphans)}
    finally:
        conn.close()


@router.post("/fetch-logos")
def fetch_logos():
    """Fetch missing company logos from TradingView. Idempotent — only fetches stocks without logo_id."""
    try:
        return {"status": "ok", **fetch_logos_from_tradingview()}
    except Exception as e:
        logger.error(f"fetch-logos error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/fetch-missing")
def fetch_missing(period: str = "5y", min_rows: int = Query(default=1, ge=1)):
    """
    Fetch 5y history for stocks with incomplete klines.
    - min_rows=1 (default): only stocks with NO klines
    - min_rows=1000: re-fetch stocks with less than ~4 years of data
    Runs synchronously — may take 1-2 minutes per stock.
    """
    try:
        result = fetch_missing_klines(period=period, min_rows=min_rows)
        return {"status": "ok", **result}
    except Exception as e:
        logger.error(f"fetch-missing error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Per-stock refetch background state — lets UI show "抓取中" spinner while
# a single stock is being refreshed
_refetching_symbols: set[str] = set()
_refetch_lock = threading.Lock()


def _refetch_one_bg(symbol: str, period: str = "5y"):
    from app.services.stock_service import fetch_yfinance, upsert_klines, upsert_metadata
    conn = get_connection()
    try:
        row = conn.execute("SELECT market FROM stocks WHERE symbol=?", (symbol,)).fetchone()
        market = (row["market"] if row else "TW") or "TW"
    finally:
        conn.close()
    try:
        df, info = fetch_yfinance(symbol, period, market=market)
        if df is not None and not df.empty:
            upsert_klines(symbol, df)
            if info:
                upsert_metadata(symbol, info)
            logger.info(f"refetch {symbol}: {len(df)} rows")
        else:
            logger.warning(f"refetch {symbol}: no data")
    except Exception as e:
        logger.error(f"refetch {symbol}: {e}")
    finally:
        with _refetch_lock:
            _refetching_symbols.discard(symbol)


@router.post("/stocks/{symbol}/refetch")
def refetch_stock(symbol: str, period: str = "5y"):
    """Fire-and-forget 5y refetch for a single stock. Returns immediately."""
    conn = get_connection()
    try:
        row = conn.execute("SELECT symbol FROM stocks WHERE symbol = ?", (symbol,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Stock {symbol} not found")
    finally:
        conn.close()

    with _refetch_lock:
        if symbol in _refetching_symbols:
            return {"status": "already_running", "symbol": symbol}
        _refetching_symbols.add(symbol)

    threading.Thread(target=_refetch_one_bg, args=(symbol, period), daemon=True).start()
    return {"status": "started", "symbol": symbol}


@router.get("/stocks/refetching")
def get_refetching():
    """List of symbols currently being refetched (for UI spinner sync)."""
    with _refetch_lock:
        return {"symbols": sorted(_refetching_symbols)}


@router.get("/institutional")
def get_institutional(date: str | None = Query(default=None, description="YYYYMMDD, default=last weekday")):
    """
    Return three-institution (外資/投信/自營商) buy/sell and margin trading
    (融資/融券) data for all stocks, sourced from TWSE and TPEx public APIs.

    Write guards:
      - Only write cache rows when at least one of the two source endpoints
        (institutional or margin) actually returned data for that symbol.
        This prevents a failed TWSE T86 fetch from overwriting a good prior
        row with all-zero defaults. A genuine zero (symbol IS in the response
        with net=0) is preserved.
    """
    try:
        result = get_institutional_data(date)

        insti_covered  = set(result.get("insti_covered", []))
        margin_covered = set(result.get("margin_covered", []))

        conn = get_connection()
        try:
            rows = []
            skipped_empty = 0
            for sym, d in result["stocks"].items():
                # Skip if NEITHER source knew about this symbol — the values
                # are all synthesised zeros, which would corrupt cache.
                if sym not in insti_covered and sym not in margin_covered:
                    skipped_empty += 1
                    continue
                rows.append((sym, result["date"],
                             d["foreign_net"], d["trust_net"],
                             d["dealer_net"],  d["total_net"],
                             d["margin_balance"], d["margin_change"],
                             d["short_balance"],  d["short_change"]))
            conn.executemany(
                """INSERT OR REPLACE INTO institutional_cache
                   (symbol, date, foreign_net, trust_net, dealer_net, total_net,
                    margin_balance, margin_change, short_balance, short_change)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                rows,
            )
            conn.commit()
            if skipped_empty:
                logger.info(f"institutional cache: skipped {skipped_empty} symbols with no source coverage")
        finally:
            conn.close()

        # Strip internal coverage keys before returning
        return {"date": result["date"], "stocks": result["stocks"]}
    except Exception as e:
        logger.error(f"Institutional data error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/business-cycle")
def get_business_cycle(force: bool = Query(default=False)):
    """
    Near-real-time 景氣燈號 (6-tier). Reads from DB cache (refreshed daily by
    scheduler). Pass ?force=true to recompute immediately.
    """
    conn = get_connection()
    try:
        if force:
            snap = business_cycle_service.refresh_business_cycle(conn)
        else:
            snap = business_cycle_service.load_latest(conn)
            if not snap:
                snap = business_cycle_service.refresh_business_cycle(conn)
        history = business_cycle_service.load_history(conn, days=60)
        return {**snap, "history": history}
    finally:
        conn.close()


class PmiPayload(BaseModel):
    value: float          # e.g. 55.2
    month: str            # e.g. "2026-04"


@router.post("/business-cycle/pmi")
def set_business_cycle_pmi(payload: PmiPayload):
    """
    Set the latest Taiwan manufacturing PMI (中經院 publishes ~1st of each
    month). We don't scrape because CIER has no stable API -- this endpoint
    lets the admin set the value from the monthly press release.
    """
    if payload.value < 0 or payload.value > 100:
        raise HTTPException(status_code=400, detail="PMI should be 0-100")
    business_cycle_service.set_pmi(payload.value, payload.month)
    # Recompute snapshot so the new PMI value flows into the dashboard
    conn = get_connection()
    try:
        business_cycle_service.refresh_business_cycle(conn)
    finally:
        conn.close()
    return {"status": "ok", "pmi": business_cycle_service.get_pmi()}


@router.get("/business-cycle/pmi")
def get_business_cycle_pmi():
    return business_cycle_service.get_pmi() or {"value": None, "month": None}


@router.post("/business-cycle/refresh-percentiles")
def refresh_business_cycle_percentiles():
    """
    Recompute 10y historical P20/P40/P60/P80 for every indicator. Run this
    once at install, then weekly on Sunday night. Scoring auto-uses
    percentiles when calibration exists.
    """
    try:
        return business_cycle_service.refresh_percentiles()
    except Exception as e:
        logger.error(f"refresh-percentiles: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/setup/progress")
def get_setup_progress():
    """First-run / startup data-sweep progress. Frontend polls this at 1Hz."""
    return setup_progress.snapshot()


@router.get("/institutional/history/{symbol}")
def institutional_history(symbol: str, days: int = Query(default=20, ge=1, le=60)):
    """Return the last N days of institutional + margin data for one symbol,
    sourced from institutional_cache. Use `POST /api/institutional/backfill`
    to fill cache if empty."""
    return {"symbol": symbol, "days": days,
            "history": institutional_service.get_history(symbol, days=days)}


@router.post("/institutional/backfill")
def institutional_backfill(days: int = Query(default=20, ge=1, le=60)):
    """Fetch last N weekdays of institutional data from TWSE/TPEx into cache.
    Runs in the foreground — small calls, ~2s per day."""
    return institutional_service.backfill_institutional_history(days=days)


@router.delete("/institutional/cache")
def clear_institutional_cache():
    """Wipe the institutional_cache table. Next GET will re-fetch fresh."""
    conn = get_connection()
    try:
        n = conn.execute("SELECT COUNT(*) FROM institutional_cache").fetchone()[0]
        conn.execute("DELETE FROM institutional_cache")
        conn.commit()
        return {"status": "ok", "removed": n}
    finally:
        conn.close()


@router.get("/news/feed")
def news_feed(
    limit: int = Query(default=150, ge=10, le=500),
    market: str | None = Query(default=None, description="TW or US; omit for global"),
):
    """Aggregated news feed across all stocks, sorted by date desc."""
    conn = get_connection()
    try:
        items = get_aggregated_feed(conn, limit=limit, market=market)
        return {"items": items, "count": len(items)}
    finally:
        conn.close()


@router.post("/news/refresh-all")
def news_refresh_all(skip_fresh_hours: float = Query(default=6.0, ge=0, le=168)):
    """
    Fire a background scrape of Google News + MOPS for every stock whose cache
    is older than `skip_fresh_hours`. Returns immediately; a single-flight lock
    coalesces concurrent calls so the frontend autopoll can't cause overlap.
    """
    global _news_refresh_running, _news_refresh_started_at

    if not _news_refresh_lock.acquire(blocking=False):
        return {"status": "already_running", "started_at": _news_refresh_started_at}
    if _news_refresh_running:
        _news_refresh_lock.release()
        return {"status": "already_running", "started_at": _news_refresh_started_at}
    _news_refresh_running = True
    _news_refresh_started_at = datetime.now(timezone.utc).isoformat()

    def _worker():
        global _news_refresh_running, _news_refresh_last_result
        try:
            conn = get_connection()
            try:
                result = refresh_all_news(conn, skip_fresh_hours=skip_fresh_hours)
                _news_refresh_last_result = result
            finally:
                conn.close()
        except Exception as e:
            logger.error(f"news_refresh_all worker failed: {e}")
            _news_refresh_last_result = {"error": str(e)}
        finally:
            _news_refresh_running = False
            _news_refresh_lock.release()

    threading.Thread(target=_worker, daemon=True).start()
    return {"status": "started", "started_at": _news_refresh_started_at}


@router.post("/news/refresh-one")
def news_refresh_one(market: str | None = Query(default=None)):
    """
    Trickle-feed refresh: scrape news for the single stock with the oldest
    cache entry (or no cache). Cheap — finishes in a couple of seconds.
    Called on every frontend autopoll tick.
    """
    conn = get_connection()
    try:
        return refresh_one_stalest(conn, market=market)
    except Exception as e:
        logger.error(f"news_refresh_one: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@router.get("/news/refresh-status")
def news_refresh_status():
    """Whether a background refresh is in flight; used by the autopoll."""
    return {
        "running": _news_refresh_running,
        "started_at": _news_refresh_started_at,
        "last_result": _news_refresh_last_result,
    }


@router.get("/stocks/{symbol}/news")
def get_stock_news(symbol: str):
    conn = get_connection()
    try:
        stock = conn.execute("SELECT name FROM stocks WHERE symbol = ?", (symbol,)).fetchone()
        if not stock:
            raise HTTPException(status_code=404, detail="Stock not found")
        return get_news(symbol, stock["name"], conn)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"News error ({symbol}): {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@router.get("/stocks/{symbol}/capacity")
def get_stock_capacity(symbol: str):
    """
    Capacity-analysis bundle: capacity-filtered MOPS + news (from existing
    cache) plus curated links to 法說會 / 年報 / 產業研究.
    """
    conn = get_connection()
    try:
        stock = conn.execute("SELECT name FROM stocks WHERE symbol = ?", (symbol,)).fetchone()
        if not stock:
            raise HTTPException(status_code=404, detail="Stock not found")
        return get_capacity_analysis(symbol, stock["name"], conn)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Capacity error ({symbol}): {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@router.get("/youtube/mentions")
def get_youtube_mentions(days: int = Query(default=7, ge=1, le=30)):
    conn = get_connection()
    try:
        return {"mentions": get_mentions(conn, days=days)}
    finally:
        conn.close()


@router.delete("/youtube/cache")
def clear_youtube_cache():
    """Delete all cached YouTube mentions so the next refresh re-processes everything."""
    conn = get_connection()
    try:
        conn.execute("DELETE FROM youtube_mentions")
        conn.commit()
        return {"status": "ok", "message": "YouTube cache cleared"}
    finally:
        conn.close()


def _run_pipeline_bg(days: int):
    global _pipeline_running, _pipeline_started_at, _pipeline_last_result
    conn = get_connection()
    try:
        result = run_youtube_pipeline(conn, days=days)
        _pipeline_last_result = result
    except Exception as e:
        logger.error(f"YouTube background pipeline error: {e}")
        _pipeline_last_result = {"error": str(e)}
    finally:
        conn.close()
        with _pipeline_lock:
            _pipeline_running = False


@router.get("/youtube/pipeline-status")
def get_pipeline_status():
    return {
        "running": _pipeline_running,
        "started_at": _pipeline_started_at,
        "last_result": _pipeline_last_result,
    }


@router.post("/youtube/refresh")
def refresh_youtube(days: int = Query(default=7, ge=1, le=14)):
    """Fire-and-forget YouTube pipeline. Returns immediately; poll /youtube/pipeline-status."""
    global _pipeline_running, _pipeline_started_at
    with _pipeline_lock:
        if _pipeline_running:
            return {"status": "already_running", "started_at": _pipeline_started_at}
        _pipeline_running = True
        _pipeline_started_at = datetime.now(timezone.utc).isoformat()

    t = threading.Thread(target=_run_pipeline_bg, args=(days,), daemon=True)
    t.start()
    return {"status": "started", "started_at": _pipeline_started_at}


@router.get("/gemini/models")
def list_gemini_models():
    """List available Gemini models for the configured API key."""
    from google import genai as genai_sdk
    import os
    key = os.getenv("GEMINI_API_KEY", "")
    if not key:
        raise HTTPException(status_code=400, detail="GEMINI_API_KEY not set")
    try:
        client = genai_sdk.Client(api_key=key)
        models = [m.name for m in client.models.list()
                  if "generateContent" in (m.supported_actions or [])]
        return {"models": sorted(models)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/last-update")
def last_update():
    conn = get_connection()
    try:
        row = conn.execute("SELECT MAX(last_updated) as t FROM metadata").fetchone()
        return {
            "last_updated": row["t"] if row and row["t"] else None,
            "status": "ok"
        }
    finally:
        conn.close()


_PLAIN_KEYS = {"YOUTUBE_CHANNEL_ID", "GEMINI_MODEL"}  # shown as plain text, not masked


@router.get("/settings")
def get_settings():
    conn = get_connection()
    try:
        keys_sql = ", ".join(f"'{k}'" for k in _SETTINGS_KEYS)
        rows = conn.execute(
            f"SELECT key, value FROM app_settings WHERE key IN ({keys_sql})"
        ).fetchall()
        db_values = {row["key"]: row["value"] for row in rows}

        result = {}
        for key in _SETTINGS_KEYS:
            value = db_values.get(key) or os.getenv(key, "")
            if key in _PLAIN_KEYS:
                result[key] = {"configured": bool(value), "masked": value}
            else:
                result[key] = {"configured": bool(value), "masked": _mask(value)}
        return result
    finally:
        conn.close()


@router.post("/settings")
def save_settings(payload: SettingsPayload):
    conn = get_connection()
    try:
        for key in _SETTINGS_KEYS:
            value = getattr(payload, key, "")
            if value:
                conn.execute(
                    "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
                    (key, value),
                )
                os.environ[key] = value
        conn.commit()
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Settings save error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


# ────────────────────────────────────────────────────────────────────────────
# KOL (財經 YouTuber) channels + feed
# ────────────────────────────────────────────────────────────────────────────

class KolChannelPayload(BaseModel):
    url_or_id: str
    name: str | None = None
    market: str | None = None   # TW or US; defaults to TW server-side


@router.get("/kol/channels")
def kol_list_channels(market: str | None = Query(default=None)):
    return kol_service.list_channels(market=market)


@router.post("/kol/channels", status_code=201)
def kol_add_channel(payload: KolChannelPayload):
    try:
        return kol_service.add_channel(
            payload.url_or_id, payload.name, market=payload.market or "TW"
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=412, detail=str(e))


@router.delete("/kol/channels/{channel_id}")
def kol_delete_channel(channel_id: str):
    ok = kol_service.delete_channel(channel_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Channel not found")
    return {"status": "ok", "channel_id": channel_id}


@router.patch("/kol/channels/{channel_id}/enabled")
def kol_toggle_channel(channel_id: str, enabled: bool = Query(...)):
    ok = kol_service.set_channel_enabled(channel_id, enabled)
    if not ok:
        raise HTTPException(status_code=404, detail="Channel not found")
    return {"status": "ok", "channel_id": channel_id, "enabled": enabled}


@router.get("/kol/feed")
def kol_feed(
    days: int = Query(default=7, ge=1, le=30),
    market: str | None = Query(default=None),
):
    return {"items": kol_service.get_kol_feed(days=days, market=market), "days": days}


@router.post("/kol/refresh")
def kol_refresh(
    days: int = Query(default=7, ge=1, le=30),
    force: bool = Query(default=False, description="Re-summarise even successful videos"),
    market: str | None = Query(default=None),
):
    """
    Background refresh: fetch recent videos from every enabled KOL channel,
    summarise via NotebookLM. Coalesced by a single-flight lock. Videos
    without a successful summariser are always retried; pass force=true to
    re-run even successful ones.
    """
    global _kol_refresh_running, _kol_refresh_started_at, _kol_refresh_last_result

    if not _kol_refresh_lock.acquire(blocking=False):
        return {"status": "already_running", "started_at": _kol_refresh_started_at}
    if _kol_refresh_running:
        _kol_refresh_lock.release()
        return {"status": "already_running", "started_at": _kol_refresh_started_at}
    _kol_refresh_running = True
    _kol_refresh_started_at = datetime.now(timezone.utc).isoformat()

    def _worker():
        global _kol_refresh_running, _kol_refresh_last_result
        try:
            _kol_refresh_last_result = kol_service.refresh_all_kol_feeds(
                days=days, force=force, market=market
            )
        except Exception as e:
            logger.error(f"kol_refresh worker: {e}")
            _kol_refresh_last_result = {"error": str(e)}
        finally:
            _kol_refresh_running = False
            _kol_refresh_lock.release()

    threading.Thread(target=_worker, daemon=True).start()
    return {"status": "started", "started_at": _kol_refresh_started_at, "force": force}


@router.get("/kol/refresh-status")
def kol_refresh_status():
    return {
        "running": _kol_refresh_running,
        "started_at": _kol_refresh_started_at,
        "last_result": _kol_refresh_last_result,
    }


@router.get("/kol/notebooklm-status")
def kol_notebooklm_status():
    """Report whether the NotebookLM CLI is installed and authenticated."""
    from app.services import notebooklm_adapter
    return notebooklm_adapter.check_auth()


@router.post("/kol/notebooklm-login")
def kol_notebooklm_login():
    """
    Trigger `notebooklm login` in the backend process. The CLI opens a
    Playwright Chromium window on the server machine (same as the user's
    browser since it's localhost) for Google OAuth; the user completes
    the login there. Returns immediately; use the status endpoint to poll.
    """
    global _nblm_login_running, _nblm_login_started_at, _nblm_login_last_result
    import subprocess
    from app.services import notebooklm_adapter

    if not _nblm_login_lock.acquire(blocking=False):
        return {"status": "already_running", "started_at": _nblm_login_started_at}
    if _nblm_login_running:
        _nblm_login_lock.release()
        return {"status": "already_running", "started_at": _nblm_login_started_at}

    cli = notebooklm_adapter.get_cli()
    if cli is None:
        _nblm_login_lock.release()
        raise HTTPException(status_code=412,
                            detail="notebooklm CLI not installed — pip install notebooklm-py")

    _nblm_login_running = True
    _nblm_login_started_at = datetime.now(timezone.utc).isoformat()
    _nblm_login_last_result = None

    def _worker():
        import sys
        global _nblm_login_running, _nblm_login_last_result
        try:
            # IMPORTANT: notebooklm login is an interactive CLI — after the
            # browser OAuth it waits for the user to press ENTER in the
            # terminal to save the cookie. So we must:
            #   1) Give it a new visible console window
            #   2) NOT redirect stdout/stderr — the instructions ("Press ENTER")
            #      must appear in that console so the user knows what to do
            # On success, the CLI writes auth.json and exits; the console
            # window closes. We then re-check auth to confirm.
            popen_kwargs: dict = {}
            if sys.platform == "win32":
                popen_kwargs["creationflags"] = subprocess.CREATE_NEW_CONSOLE
                # Wrap in cmd /k so the window stays open even after the CLI
                # exits — user can read any final message.
                args = ["cmd", "/k", *cli, "login"]
            else:
                args = cli + ["login"]

            p = subprocess.Popen(args, **popen_kwargs)
            try:
                # Give user up to 15 min to complete Google OAuth + press ENTER
                p.wait(timeout=900)
            except subprocess.TimeoutExpired:
                try: p.kill()
                except Exception: pass
                _nblm_login_last_result = {"returncode": 124,
                                            "error": "登入超時（>15 分鐘） — 請重試"}
                return

            from app.services import notebooklm_adapter
            auth = notebooklm_adapter.check_auth()
            if auth.get("authenticated"):
                _nblm_login_last_result = {"returncode": 0, "authenticated": True}
            else:
                _nblm_login_last_result = {
                    "returncode": p.returncode if p.returncode is not None else -1,
                    "error": (
                        "cmd 視窗關閉了，但 NotebookLM 狀態仍未通過驗證。\n\n"
                        "常見原因：\n"
                        "1. 完成 Google 登入後，必須回到彈出的 cmd 黑色視窗「按 ENTER」才會儲存 cookie\n"
                        "2. 若 Google 顯示「無法登入（瀏覽器不安全）」，是 Playwright 被偵測 — 請改用 "
                        "`NOTEBOOKLM_AUTH_JSON` 方式手動匯入 cookie（見 SKILL.md）\n"
                    ),
                    "auth_message": auth.get("message", ""),
                }
        except Exception as e:
            _nblm_login_last_result = {"returncode": -1, "error": str(e)}
        finally:
            _nblm_login_running = False
            _nblm_login_lock.release()

    threading.Thread(target=_worker, daemon=True).start()
    return {"status": "started", "started_at": _nblm_login_started_at}


@router.get("/kol/notebooklm-login/status")
def kol_notebooklm_login_status():
    return {
        "running": _nblm_login_running,
        "started_at": _nblm_login_started_at,
        "last_result": _nblm_login_last_result,
    }


# ────────────────────────────────────────────────────────────────────────────
# Facebook pages + feed
# ────────────────────────────────────────────────────────────────────────────

class FbPagePayload(BaseModel):
    url_or_handle: str
    name: str | None = None
    market: str | None = None   # TW or US; defaults to TW server-side


@router.get("/fb/pages")
def fb_list_pages(market: str | None = Query(default=None)):
    return fb_service.list_pages(market=market)


@router.post("/fb/pages", status_code=201)
def fb_add_page(payload: FbPagePayload):
    import sqlite3
    try:
        return fb_service.add_page(
            payload.url_or_handle, payload.name, market=payload.market or "TW"
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except sqlite3.OperationalError as e:
        # DB was locked by a long-running background job (FB refresh etc.)
        # Surface a retryable 503 instead of a bare 500.
        raise HTTPException(status_code=503,
            detail=f"資料庫暫時忙碌，請 10 秒後再試：{e}")


@router.delete("/fb/pages/{page_id}")
def fb_delete_page(page_id: str):
    ok = fb_service.delete_page(page_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Page not found")
    return {"status": "ok", "id": page_id}


@router.patch("/fb/pages/{page_id}/enabled")
def fb_toggle_page(page_id: str, enabled: bool = Query(...)):
    ok = fb_service.set_page_enabled(page_id, enabled)
    if not ok:
        raise HTTPException(status_code=404, detail="Page not found")
    return {"status": "ok", "id": page_id, "enabled": enabled}


@router.get("/fb/feed")
def fb_get_feed(
    days: int = Query(default=7, ge=1, le=60),
    limit: int = Query(default=100, ge=10, le=500),
    market: str | None = Query(default=None),
):
    return {"items": fb_service.get_feed(days=days, limit=limit, market=market), "days": days}


@router.delete("/fb/posts")
def fb_clear_posts():
    """Wipe the scraped post cache (keeps configured pages). Use after
    scraper improvements to clear stale / garbage content."""
    n = fb_service.clear_all_posts()
    return {"status": "ok", "removed": n}


@router.post("/fb/reanalyse")
def fb_reanalyse(force: bool = Query(default=False,
                 description="true=ignore cache and re-analyse every post (burns quota)")):
    """
    Re-run Gemini analysis on stored FB posts (background).
    Default skips posts that already have a successful Gemini result —
    pass ?force=true to force re-analysis of everything.
    """
    def _worker():
        try:
            fb_service.reanalyse_all_posts(force=force)
        except Exception as e:
            logger.error(f"fb_reanalyse: {e}")
    threading.Thread(target=_worker, daemon=True).start()
    return {"status": "started", "force": force}


@router.get("/fb/debug")
def fb_debug(url: str = Query(...)):
    """Run the scraper against an arbitrary URL and return diagnostics.
    Use this to troubleshoot when posts don't appear — it returns the
    counts the DOM sees plus the first few extracted posts without persisting."""
    return fb_service.scrape_debug(url)


@router.post("/fb/refresh")
def fb_refresh(
    days: int = Query(default=7, ge=1, le=30),
    market: str | None = Query(default=None),
):
    global _fb_refresh_running, _fb_refresh_started_at, _fb_refresh_last_result
    if not _fb_refresh_lock.acquire(blocking=False):
        return {"status": "already_running", "started_at": _fb_refresh_started_at}
    if _fb_refresh_running:
        _fb_refresh_lock.release()
        return {"status": "already_running", "started_at": _fb_refresh_started_at}
    _fb_refresh_running = True
    _fb_refresh_started_at = datetime.now(timezone.utc).isoformat()

    def _worker():
        global _fb_refresh_running, _fb_refresh_last_result
        try:
            _fb_refresh_last_result = fb_service.refresh_all_pages(days=days, market=market)
        except Exception as e:
            logger.error(f"fb_refresh worker: {e}")
            _fb_refresh_last_result = {"error": str(e)}
        finally:
            _fb_refresh_running = False
            _fb_refresh_lock.release()

    threading.Thread(target=_worker, daemon=True).start()
    return {"status": "started", "started_at": _fb_refresh_started_at}


@router.get("/fb/refresh-status")
def fb_refresh_status():
    return {
        "running": _fb_refresh_running,
        "started_at": _fb_refresh_started_at,
        "last_result": _fb_refresh_last_result,
    }


@router.get("/fb/auth-status")
def fb_auth_status():
    return fb_service.check_auth()


@router.post("/fb/login")
def fb_login():
    global _fb_login_running, _fb_login_started_at, _fb_login_last_result
    if not _fb_login_lock.acquire(blocking=False):
        return {"status": "already_running", "started_at": _fb_login_started_at}
    if _fb_login_running:
        _fb_login_lock.release()
        return {"status": "already_running", "started_at": _fb_login_started_at}
    _fb_login_running = True
    _fb_login_started_at = datetime.now(timezone.utc).isoformat()
    _fb_login_last_result = None

    def _worker():
        global _fb_login_running, _fb_login_last_result
        try:
            rc, err = fb_service.launch_login_window()
            auth = fb_service.check_auth()
            _fb_login_last_result = {
                "returncode": rc,
                "authenticated": auth.get("authenticated"),
                "message": auth.get("message"),
                "stderr_tail": err,
            }
        except Exception as e:
            _fb_login_last_result = {"returncode": -1, "error": str(e)}
        finally:
            _fb_login_running = False
            _fb_login_lock.release()

    threading.Thread(target=_worker, daemon=True).start()
    return {"status": "started", "started_at": _fb_login_started_at}


@router.get("/fb/login-status")
def fb_login_status():
    return {
        "running": _fb_login_running,
        "started_at": _fb_login_started_at,
        "last_result": _fb_login_last_result,
    }
