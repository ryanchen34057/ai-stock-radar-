from fastapi import APIRouter, HTTPException, Query
from app.services.stock_service import get_dashboard_data, update_all_stocks, load_stocks_json, fetch_missing_klines, fetch_logos_from_tradingview
from app.services.institutional_service import get_institutional_data
from app.services.news_service import get_news, get_aggregated_feed, refresh_all_news
from app.services.youtube_service import get_mentions, run_youtube_pipeline
from app.database import get_connection
from datetime import datetime, timezone
from pydantic import BaseModel
import logging
import os
import threading

router = APIRouter(prefix="/api")
logger = logging.getLogger(__name__)

# Pipeline background state
_pipeline_lock = threading.Lock()
_pipeline_running = False
_pipeline_started_at: str | None = None
_pipeline_last_result: dict | None = None

_SETTINGS_KEYS = {"YOUTUBE_API_KEY", "GEMINI_API_KEY", "YOUTUBE_CHANNEL_ID", "GEMINI_MODEL"}


class SettingsPayload(BaseModel):
    YOUTUBE_API_KEY: str = ""
    GEMINI_API_KEY: str = ""
    YOUTUBE_CHANNEL_ID: str = ""
    GEMINI_MODEL: str = ""


def _mask(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 8:
        return "*" * len(key)
    return key[:4] + "*" * (len(key) - 8) + key[-4:]


@router.get("/stocks")
def list_stocks():
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT symbol, name, layer, layer_name, sub_category, note, theme, themes FROM stocks ORDER BY theme, layer, symbol"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


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


@router.get("/dashboard")
def get_dashboard():
    try:
        return get_dashboard_data()
    except Exception as e:
        logger.error(f"Dashboard error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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
    current = {s["symbol"] for s in load_stocks_json()}
    conn = get_connection()
    try:
        db_syms = {row[0] for row in conn.execute("SELECT symbol FROM stocks").fetchall()}
        orphans = db_syms - current
        for sym in orphans:
            conn.execute("DELETE FROM stocks WHERE symbol=?", (sym,))
            conn.execute("DELETE FROM klines WHERE symbol=?", (sym,))
            conn.execute("DELETE FROM metadata WHERE symbol=?", (sym,))
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


@router.get("/institutional")
def get_institutional(date: str | None = Query(default=None, description="YYYYMMDD, default=last weekday")):
    """
    Return three-institution (外資/投信/自營商) buy/sell and margin trading
    (融資/融券) data for all stocks, sourced from TWSE and TPEx public APIs.
    """
    try:
        result = get_institutional_data(date)

        # Cache in DB
        conn = get_connection()
        try:
            rows = []
            for sym, d in result["stocks"].items():
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
        finally:
            conn.close()

        return result
    except Exception as e:
        logger.error(f"Institutional data error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/news/feed")
def news_feed(limit: int = Query(default=150, ge=10, le=500)):
    """Aggregated news feed across all stocks, sorted by date desc."""
    conn = get_connection()
    try:
        items = get_aggregated_feed(conn, limit=limit)
        return {"items": items, "count": len(items)}
    finally:
        conn.close()


@router.post("/news/refresh-all")
def news_refresh_all(skip_fresh_hours: int = Query(default=6, ge=0, le=168)):
    """Background-fetch Google News for every stock (only stale or missing cache)."""
    conn = get_connection()
    try:
        result = refresh_all_news(conn, skip_fresh_hours=skip_fresh_hours)
        return {"status": "ok", **result}
    finally:
        conn.close()


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
