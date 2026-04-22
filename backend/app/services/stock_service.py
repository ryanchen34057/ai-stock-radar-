import yfinance as yf
import pandas as pd
import sqlite3
import json
import logging
import math
import time
import random
from pathlib import Path
from datetime import datetime, timezone, timedelta
from app.database import get_connection, DB_PATH


def _finite(v):
    """
    Coerce DB-stored numerics to a JSON-safe finite float (or None).
    Handles the SQLite edge case where float('inf')/nan are persisted as the
    strings 'Infinity'/'NaN', which FastAPI then re-emits unchanged and crashes
    frontend `.toFixed()` calls.
    """
    if v is None:
        return None
    if isinstance(v, str):
        try:
            v = float(v)
        except (TypeError, ValueError):
            return None
    if isinstance(v, float) and not math.isfinite(v):
        return None
    return v

logger = logging.getLogger(__name__)

STOCKS_JSON = Path(__file__).parent.parent.parent / "data" / "stocks.json"


def load_stocks_json() -> list[dict]:
    with open(STOCKS_JSON, encoding="utf-8") as f:
        return json.load(f)


def seed_stocks_table():
    """Insert stocks from stocks.json into DB if not present, update metadata fields."""
    stocks = load_stocks_json()
    conn = get_connection()
    try:
        for s in stocks:
            conn.execute(
                """INSERT OR IGNORE INTO stocks
                   (symbol, name, layer, layer_name, sub_category, note, theme, themes,
                    industry_role, secondary_layers, tier, enabled)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (s["symbol"], s["name"], s["layer"], s["layer_name"],
                 s.get("sub_category"), s.get("note"),
                 s.get("theme", "A"),
                 json.dumps(s["themes"]) if s.get("themes") else None,
                 s.get("industry_role"),
                 json.dumps(s["secondary_layers"]) if s.get("secondary_layers") else None,
                 int(s.get("tier", 2)),
                 1 if s.get("enabled", True) else 0)
            )
        # For stocks already in DB, refresh everything except user-editable
        # flags (enabled) — so spec updates flow through without overwriting
        # the user's disable choices.
        for s in stocks:
            conn.execute(
                """UPDATE stocks SET
                     name=?, layer=?, layer_name=?, sub_category=?, note=?,
                     theme=?, themes=?, industry_role=?, secondary_layers=?, tier=?
                   WHERE symbol=?""",
                (s["name"], s["layer"], s["layer_name"],
                 s.get("sub_category"), s.get("note"),
                 s.get("theme", "A"),
                 json.dumps(s["themes"]) if s.get("themes") else None,
                 s.get("industry_role"),
                 json.dumps(s["secondary_layers"]) if s.get("secondary_layers") else None,
                 int(s.get("tier", 2)),
                 s["symbol"])
            )
        conn.commit()
        logger.info(f"Seeded {len(stocks)} stocks")
    finally:
        conn.close()


def fetch_yfinance(symbol: str, period: str = "5y") -> tuple[pd.DataFrame | None, dict]:
    """Try .TW then .TWO suffix with retry on rate-limit errors."""
    suffixes = [".TW", ".TWO"]
    max_retries = 3

    for suffix in suffixes:
        for attempt in range(max_retries):
            try:
                ticker = yf.Ticker(f"{symbol}{suffix}")
                hist = ticker.history(period=period)
                if hist.empty:
                    break  # This suffix has no data, try next one
                try:
                    info = ticker.info
                except Exception:
                    info = {}
                logger.info(f"✓ {symbol}{suffix}: {len(hist)} rows (attempt {attempt+1})")
                return hist, info
            except Exception as e:
                err = str(e).lower()
                if "404" in err or "not found" in err or "delisted" in err:
                    break  # Definitive no-data, try next suffix
                # Likely rate-limited — back off and retry
                wait = 3 * (attempt + 1) + random.uniform(1, 3)
                logger.warning(f"  {symbol}{suffix} attempt {attempt+1} failed: {e} — retry in {wait:.1f}s")
                time.sleep(wait)

    logger.warning(f"✗ {symbol}: no data from .TW or .TWO")
    return None, {}


def upsert_klines(symbol: str, df: pd.DataFrame):
    """Insert or replace klines from a yfinance history DataFrame."""
    conn = get_connection()
    try:
        rows = []
        for date, row in df.iterrows():
            date_str = date.strftime("%Y-%m-%d") if hasattr(date, "strftime") else str(date)[:10]
            rows.append((
                symbol, date_str,
                float(row["Open"]), float(row["High"]),
                float(row["Low"]), float(row["Close"]),
                int(row["Volume"]) if not pd.isna(row["Volume"]) else 0
            ))
        conn.executemany(
            """INSERT OR REPLACE INTO klines (symbol, date, open, high, low, close, volume)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            rows
        )
        conn.commit()
    finally:
        conn.close()


def upsert_metadata(symbol: str, info: dict):
    """Save PE, market cap, forecast EPS and valuation ratios to metadata."""
    pe = info.get("trailingPE") or info.get("forwardPE")
    cap = info.get("marketCap")
    eps_cy = info.get("epsCurrentYear")
    eps_fwd = info.get("epsForward")
    fwd_pe = info.get("forwardPE")
    # yfinance returns dividendYield as a percent already (e.g. 1.18 = 1.18%).
    # Others are decimals — we keep them as decimals and format in the frontend.
    div_yield = info.get("dividendYield")
    pb = info.get("priceToBook")
    roe = info.get("returnOnEquity")       # 0.3621 → 36.21%
    rev_growth = info.get("revenueGrowth") # 0.351 → 35.1%
    now = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        # Use an upsert that only touches the yfinance-owned columns so we
        # don't clobber FinMind-owned fields (ttm_eps, monthly_revenue_yoy,
        # ttm_dividend, ttm_dividend_yield) written by finmind_service.
        conn.execute(
            "INSERT OR IGNORE INTO metadata (symbol) VALUES (?)",
            (symbol,),
        )
        conn.execute(
            """UPDATE metadata SET
                 pe_ratio=?, market_cap=?, eps_current_year=?, eps_forward=?,
                 forward_pe=?, dividend_yield=?, pb_ratio=?, roe=?,
                 revenue_growth=?, last_updated=?
               WHERE symbol=?""",
            (pe, cap, eps_cy, eps_fwd, fwd_pe,
             div_yield, pb, roe, rev_growth, now, symbol)
        )
        conn.commit()
    finally:
        conn.close()


def calculate_ma(closes: list[float], period: int) -> float | None:
    if len(closes) < period:
        return None
    return round(sum(closes[-period:]) / period, 2)


def get_dashboard_data() -> dict:
    """Build full dashboard response from DB."""
    # Pull current disposal list (date-filtered) once for this request
    try:
        from app.services.disposal_service import get_active_disposal_map
        disposal_map = get_active_disposal_map()
    except Exception as e:
        logger.warning(f"disposal map unavailable: {e}")
        disposal_map = {}

    # Intraday live quotes from TWSE MIS (populated every 5 min by the
    # scheduler during market hours). Falls back to latest kline close when
    # no live quote is available.
    try:
        from app.services.twse_mis_service import get_all_quotes
        live_quotes = get_all_quotes()
    except Exception as e:
        logger.warning(f"live quotes unavailable: {e}")
        live_quotes = {}

    # TDCC 千張大戶 latest week + WoW change per tracked symbol
    try:
        from app.services.shareholding_service import get_latest_per_symbol
        big_holder_map = get_latest_per_symbol()
    except Exception as e:
        logger.warning(f"shareholding unavailable: {e}")
        big_holder_map = {}

    conn = get_connection()
    try:
        stocks_rows = conn.execute(
            "SELECT * FROM stocks WHERE enabled = 1 ORDER BY layer, symbol"
        ).fetchall()

        # Preload EPS for all symbols (cheaper than per-stock queries)
        eps_annual_map: dict[str, list[dict]] = {}
        for r in conn.execute(
            "SELECT symbol, year, basic_eps, diluted_eps FROM eps_annual ORDER BY symbol, year DESC"
        ).fetchall():
            eps_annual_map.setdefault(r["symbol"], []).append({
                "year": r["year"],
                "basic_eps": r["basic_eps"],
                "diluted_eps": r["diluted_eps"],
            })
        eps_quarterly_map: dict[str, list[dict]] = {}
        for r in conn.execute(
            "SELECT symbol, period_end, basic_eps, diluted_eps FROM eps_quarterly ORDER BY symbol, period_end DESC"
        ).fetchall():
            eps_quarterly_map.setdefault(r["symbol"], []).append({
                "period_end": r["period_end"],
                "basic_eps": r["basic_eps"],
                "diluted_eps": r["diluted_eps"],
            })

        result = []
        for stock in stocks_rows:
            symbol = stock["symbol"]

            # Get last 1300 klines (~5y) for MA calculation; dashboard displays only last 60
            kline_rows = conn.execute(
                """SELECT date, open, high, low, close, volume
                   FROM klines WHERE symbol = ?
                   ORDER BY date DESC LIMIT 1300""",
                (symbol,)
            ).fetchall()
            klines_all = list(reversed([dict(r) for r in kline_rows]))

            # Last ~1 year (260 bars) for display. The main card only draws
            # the tail 60, but frontend filters like VCP candidate scan need
            # enough history to check MA200 trend + 52-week high/low +
            # pivot detection over a 65-bar base.
            klines_display = klines_all[-260:] if len(klines_all) > 260 else klines_all

            closes = [k["close"] for k in klines_all]
            current = klines_all[-1] if klines_all else None
            prev = klines_all[-2] if len(klines_all) >= 2 else None

            current_price = current["close"] if current else None
            change = None
            change_pct = None
            if current and prev and prev["close"]:
                change = round(current["close"] - prev["close"], 2)
                change_pct = round(change / prev["close"] * 100, 2)

            # Override with live TWSE MIS quote when available. MIS price is
            # the latest intraday trade, so we get real-time updates during
            # TW market hours (09:00–13:30) instead of yesterday's close.
            live = live_quotes.get(symbol)
            if live and live.get("price") is not None:
                current_price = live["price"]
                change     = live.get("change")
                change_pct = live.get("change_pct")

            ma_values = {}
            for p in [5, 10, 20, 60, 120, 240]:
                ma_values[str(p)] = calculate_ma(closes, p)

            meta = conn.execute(
                "SELECT * FROM metadata WHERE symbol = ?", (symbol,)
            ).fetchone()

            # 20-day high / all-time high flags
            is_20d_high = False
            is_all_time_high = False
            if current_price is not None and len(closes) >= 1:
                if len(closes) >= 20:
                    is_20d_high = current_price >= max(closes[-20:]) - 0.01
                is_all_time_high = current_price >= max(closes) - 0.01

            themes_raw = stock["themes"] if stock["themes"] else None
            sec_raw = stock["secondary_layers"] if "secondary_layers" in stock.keys() and stock["secondary_layers"] else None

            # Data completeness: we distinguish "full historical fetch done"
            # from "only the 5-day daily update touched this stock" by the
            # AGE of the earliest kline — not by row count. A recently-IPO'd
            # stock legitimately has few rows but earliest is still months old
            # (after a 5y fetch), whereas a stock we've never done a 5y fetch
            # for only has 5-7 rows all within the last week.
            earliest = klines_all[0]["date"] if klines_all else None
            data_complete = False
            if earliest:
                try:
                    earliest_dt = datetime.strptime(earliest, "%Y-%m-%d")
                    # ≥ 30 days of history implies a real historical fetch ran at
                    # some point (daily 5d update alone can only create ≤ 5 rows
                    # spanning < 7 days). Newly-IPO'd stocks < 30 days old are
                    # flagged incomplete — rare edge case, user can ignore.
                    if (datetime.now() - earliest_dt).days >= 30:
                        data_complete = True
                except Exception:
                    pass

            result.append({
                "symbol": symbol,
                "name": stock["name"],
                "layer": stock["layer"],
                "layer_name": stock["layer_name"],
                "sub_category": stock["sub_category"],
                "note": stock["note"],
                "theme": stock["theme"] if stock["theme"] else "A",
                "themes": json.loads(themes_raw) if themes_raw else None,
                "industry_role": stock["industry_role"] if "industry_role" in stock.keys() else None,
                "secondary_layers": json.loads(sec_raw) if sec_raw else None,
                "logo_id": stock["logo_id"] if "logo_id" in stock.keys() else None,
                "tier": stock["tier"] if "tier" in stock.keys() else 2,
                "enabled": bool(stock["enabled"]) if "enabled" in stock.keys() else True,
                "current_price": current_price,
                "change": change,
                "change_percent": change_pct,
                "volume": current["volume"] if current else None,
                "pe_ratio": _finite(dict(meta)["pe_ratio"]) if meta else None,
                "market_cap": _finite(dict(meta)["market_cap"]) if meta else None,
                "eps_current_year": _finite(dict(meta).get("eps_current_year")) if meta else None,
                "eps_forward": _finite(dict(meta).get("eps_forward")) if meta else None,
                "forward_pe": _finite(dict(meta).get("forward_pe")) if meta else None,
                "dividend_yield": _finite(dict(meta).get("dividend_yield")) if meta else None,
                "pb_ratio": _finite(dict(meta).get("pb_ratio")) if meta else None,
                "roe": _finite(dict(meta).get("roe")) if meta else None,
                "revenue_growth": _finite(dict(meta).get("revenue_growth")) if meta else None,
                # FinMind-sourced (more accurate for TW stocks)
                "ttm_eps": _finite(dict(meta).get("ttm_eps")) if meta else None,
                "monthly_revenue_yoy": _finite(dict(meta).get("monthly_revenue_yoy")) if meta else None,
                "ttm_dividend": _finite(dict(meta).get("ttm_dividend")) if meta else None,
                "ttm_dividend_yield": _finite(dict(meta).get("ttm_dividend_yield")) if meta else None,
                "ma": ma_values,
                "klines": klines_display,
                "is_20d_high": is_20d_high,
                "is_all_time_high": is_all_time_high,
                "eps_annual": eps_annual_map.get(symbol, []),
                "eps_quarterly": eps_quarterly_map.get(symbol, []),
                "disposal": disposal_map.get(symbol),  # null if not currently disposed
                "big_holder": big_holder_map.get(symbol),  # TDCC 千張大戶 latest + WoW change
                "data_complete": data_complete,
                "kline_count": len(klines_all),
            })

        # Last updated time
        meta_row = conn.execute(
            "SELECT MAX(last_updated) as t FROM metadata"
        ).fetchone()
        last_updated = (meta_row["t"] if meta_row and meta_row["t"]
                        else datetime.now(timezone.utc).isoformat())

        return {"last_updated": last_updated, "stocks": result}
    finally:
        conn.close()


def fetch_missing_klines(period: str = "5y", min_rows: int = 1):
    """
    Fetch 5y klines for stocks whose historical data looks incomplete.

    Completeness is determined by the AGE of the earliest kline, not the row
    count: a stock is considered complete once we have at least ~30 days of
    history (real 5y fetch always spans > 30 days; the daily 5d update alone
    only spans < 7 days). This correctly skips newly-IPO'd stocks that have
    few rows but were already fully fetched.

    The legacy `min_rows` parameter is still respected: if set > 1, stocks
    with fewer rows than that are considered incomplete even if they have
    >= 30 days of history (useful for forced backfill).
    """
    from datetime import datetime as _dt, timedelta as _td
    stocks = load_stocks_json()
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT symbol, COUNT(*), MIN(date) FROM klines GROUP BY symbol"
        ).fetchall()
        counts = {r[0]: r[1] for r in rows}
        earliest = {r[0]: r[2] for r in rows}
    finally:
        conn.close()

    targets = []
    now = _dt.now()
    for s in stocks:
        sym = s["symbol"]
        n = counts.get(sym, 0)
        first = earliest.get(sym)

        # No data at all -> always incomplete
        if n == 0 or not first:
            targets.append(s)
            continue

        # Compute age of earliest kline
        try:
            first_dt = _dt.strptime(first, "%Y-%m-%d")
            days_old = (now - first_dt).days
        except Exception:
            days_old = 0

        # Standard signal: < 30 days of history -> only daily update has touched this stock
        if days_old < 30:
            targets.append(s)
            continue

        # Backwards-compat: allow caller to force-refetch stocks under min_rows
        # (use only for explicit /api/fetch-missing?min_rows=N backfill)
        if min_rows > 1 and n < min_rows:
            # Skip if earliest is already > 4.5y ago (can't get more from yfinance)
            if days_old < 5 * 365 - 60:
                targets.append(s)
            continue
    if not targets:
        logger.info(f"fetch_missing_klines(min_rows={min_rows}): all stocks OK")
        return {"targets": 0, "success": 0, "failed": []}

    logger.info(f"fetch_missing_klines(min_rows={min_rows}): {len(targets)} stock(s) — fetching {period}")
    success = 0
    failed: list[str] = []
    for i, s in enumerate(targets):
        symbol = s["symbol"]
        current = counts.get(symbol, 0)
        logger.info(f"  [{i+1}/{len(targets)}] {symbol} {s['name']} (current: {current} rows)")
        try:
            df, info = fetch_yfinance(symbol, period)
            if df is not None and not df.empty:
                upsert_klines(symbol, df)
                upsert_metadata(symbol, info)
                logger.info(f"  ✓ {symbol}: {len(df)} rows")
                success += 1
            else:
                logger.warning(f"  ✗ {symbol}: no data")
                failed.append(symbol)
        except Exception as e:
            logger.error(f"  ✗ {symbol}: {e}")
            failed.append(symbol)
        time.sleep(random.uniform(2.0, 4.0))
    return {"targets": len(targets), "success": success, "failed": failed}


def fetch_yfinance_range(symbol: str, start: str, end: str) -> tuple[pd.DataFrame | None, dict]:
    """Fetch klines in [start, end). Tries .TW then .TWO, with rate-limit retry."""
    suffixes = [".TW", ".TWO"]
    max_retries = 3
    for suffix in suffixes:
        for attempt in range(max_retries):
            try:
                ticker = yf.Ticker(f"{symbol}{suffix}")
                hist = ticker.history(start=start, end=end)
                if hist.empty:
                    break
                try:
                    info = ticker.info
                except Exception:
                    info = {}
                logger.info(f"✓ {symbol}{suffix}: {len(hist)} rows [{start}..{end}) (attempt {attempt+1})")
                return hist, info
            except Exception as e:
                err = str(e).lower()
                if "404" in err or "not found" in err or "delisted" in err:
                    break
                wait = 3 * (attempt + 1) + random.uniform(1, 3)
                logger.warning(f"  {symbol}{suffix} attempt {attempt+1} failed: {e} — retry in {wait:.1f}s")
                time.sleep(wait)
    return None, {}


def ensure_klines_current(backfill_period: str = "5y"):
    """
    Startup sweep: for each stock, make sure klines reach today's Taipei date.
    - No klines at all → fetch `backfill_period` (default 5y).
    - Latest kline < latest trading day → incremental fetch from (latest+1) to today.
    - Already current → skip.

    Weekends/holidays fall through harmlessly (yfinance returns empty).
    """
    from datetime import datetime as _dt, timedelta as _td
    import pytz

    tz = pytz.timezone("Asia/Taipei")
    today = _dt.now(tz).date()
    # Approximate latest trading day (ignores TW holidays — those just produce empty fetches)
    latest_trading = today
    while latest_trading.weekday() >= 5:  # Sat=5, Sun=6
        latest_trading -= _td(days=1)
    target_str = latest_trading.strftime("%Y-%m-%d")

    stocks = load_stocks_json()
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT symbol, MAX(date) FROM klines GROUP BY symbol"
        ).fetchall()
        latest = {r[0]: r[1] for r in rows}
    finally:
        conn.close()

    targets: list[tuple[dict, str | None]] = []
    for s in stocks:
        last = latest.get(s["symbol"])
        if last and last >= target_str:
            continue
        targets.append((s, last))

    if not targets:
        logger.info(f"ensure_klines_current: all {len(stocks)} stocks up-to-date ({target_str})")
        return {"targets": 0, "success": 0, "failed": []}

    logger.info(
        f"ensure_klines_current: {len(targets)}/{len(stocks)} stock(s) need update "
        f"(target date {target_str})"
    )
    from app.services import setup_progress as _prog
    _prog.begin("klines", total=len(targets))
    success = 0
    failed: list[str] = []
    end_str = (today + _td(days=1)).strftime("%Y-%m-%d")  # yfinance end is exclusive

    for i, (s, last) in enumerate(targets):
        symbol = s["symbol"]
        _prog.update(current=i + 1, symbol=symbol, name=s["name"])
        try:
            if last:
                start_str = (_dt.strptime(last, "%Y-%m-%d").date() + _td(days=1)).strftime("%Y-%m-%d")
                logger.info(f"  [{i+1}/{len(targets)}] {symbol} {s['name']}: incremental {start_str}..{end_str}")
                df, info = fetch_yfinance_range(symbol, start_str, end_str)
            else:
                logger.info(f"  [{i+1}/{len(targets)}] {symbol} {s['name']}: no data — fetching {backfill_period}")
                df, info = fetch_yfinance(symbol, backfill_period)

            if df is not None and not df.empty:
                upsert_klines(symbol, df)
                if info:
                    upsert_metadata(symbol, info)
                logger.info(f"  ✓ {symbol}: +{len(df)} rows")
                success += 1
            else:
                # No new data — likely holiday or delisted. Not a hard failure.
                logger.info(f"  – {symbol}: no new rows from yfinance")
        except Exception as e:
            logger.error(f"  ✗ {symbol}: {e}")
            failed.append(symbol)
        time.sleep(random.uniform(1.5, 3.0))

    logger.info(f"ensure_klines_current done: {success} updated, {len(failed)} failed: {failed}")
    return {"targets": len(targets), "success": success, "failed": failed}


def _extract_eps_rows(df, key: str) -> list[tuple[str, float | None, float | None]]:
    """
    Pull Basic EPS / Diluted EPS rows from a yfinance income-statement DataFrame.
    Returns list of (period_end_str, basic, diluted) — skipping rows where both are NaN.
    `key` is "year" (yyyy) for annual or "date" (yyyy-mm-dd) for quarterly.
    """
    if df is None or df.empty:
        return []
    basic = df.loc["Basic EPS"] if "Basic EPS" in df.index else None
    diluted = df.loc["Diluted EPS"] if "Diluted EPS" in df.index else None
    if basic is None and diluted is None:
        return []

    out: list[tuple[str, float | None, float | None]] = []
    for col in df.columns:
        label = col.strftime("%Y") if key == "year" else col.strftime("%Y-%m-%d")
        b = basic[col] if basic is not None else None
        d = diluted[col] if diluted is not None else None
        bv = float(b) if b is not None and not pd.isna(b) else None
        dv = float(d) if d is not None and not pd.isna(d) else None
        if bv is None and dv is None:
            continue
        out.append((label, bv, dv))
    return out


def fetch_eps_for_stock(symbol: str) -> tuple[pd.DataFrame | None, pd.DataFrame | None, dict]:
    """
    Fetch annual + quarterly income statements and info (for forecast EPS)
    for a single symbol. Tries .TW then .TWO with retry on transient errors.
    """
    suffixes = [".TW", ".TWO"]
    max_retries = 3
    for suffix in suffixes:
        for attempt in range(max_retries):
            try:
                ticker = yf.Ticker(f"{symbol}{suffix}")
                annual = ticker.income_stmt
                quarterly = ticker.quarterly_income_stmt
                has_any = (
                    (annual is not None and not annual.empty) or
                    (quarterly is not None and not quarterly.empty)
                )
                if has_any:
                    try:
                        info = ticker.info
                    except Exception:
                        info = {}
                    logger.info(f"✓ {symbol}{suffix} EPS fetched (attempt {attempt+1})")
                    return annual, quarterly, info
                break  # empty — try next suffix
            except Exception as e:
                err = str(e).lower()
                if "404" in err or "not found" in err or "delisted" in err:
                    break
                wait = 3 * (attempt + 1) + random.uniform(1, 3)
                logger.warning(f"  {symbol}{suffix} EPS attempt {attempt+1} failed: {e} — retry in {wait:.1f}s")
                time.sleep(wait)
    logger.warning(f"✗ {symbol}: no EPS data from .TW or .TWO")
    return None, None, {}


def upsert_eps(symbol: str, annual, quarterly):
    """Persist annual + quarterly EPS rows into eps_annual / eps_quarterly tables."""
    annual_rows = _extract_eps_rows(annual, "year")
    quarterly_rows = _extract_eps_rows(quarterly, "date")
    conn = get_connection()
    try:
        for label, b, d in annual_rows:
            conn.execute(
                "INSERT OR REPLACE INTO eps_annual (symbol, year, basic_eps, diluted_eps) VALUES (?, ?, ?, ?)",
                (symbol, int(label), b, d),
            )
        for label, b, d in quarterly_rows:
            conn.execute(
                "INSERT OR REPLACE INTO eps_quarterly (symbol, period_end, basic_eps, diluted_eps) VALUES (?, ?, ?, ?)",
                (symbol, label, b, d),
            )
        conn.commit()
    finally:
        conn.close()
    return len(annual_rows), len(quarterly_rows)


def ensure_eps_current():
    """
    Startup sweep: fetch EPS for any stock whose latest annual EPS year is older
    than (current_year - 1), or which has no EPS rows at all. Annual reports for
    year N usually publish in Q1/Q2 of year N+1, so keeping year >= current-1
    is a reasonable 'up-to-date' threshold.
    """
    from datetime import datetime as _dt
    import pytz

    current_year = _dt.now(pytz.timezone("Asia/Taipei")).year
    threshold = current_year - 1

    stocks = load_stocks_json()
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT symbol, MAX(year) FROM eps_annual GROUP BY symbol"
        ).fetchall()
        latest = {r[0]: r[1] for r in rows}
        meta_rows = conn.execute(
            "SELECT symbol, eps_current_year FROM metadata"
        ).fetchall()
        has_forecast = {r[0] for r in meta_rows if r[1] is not None}
    finally:
        conn.close()

    # Need update if: annual EPS behind threshold OR no forecast EPS on file yet
    targets = [
        s for s in stocks
        if (latest.get(s["symbol"]) or 0) < threshold
        or s["symbol"] not in has_forecast
    ]
    if not targets:
        logger.info(f"ensure_eps_current: all {len(stocks)} stocks already have EPS >= {threshold}")
        return {"targets": 0, "success": 0, "failed": []}

    logger.info(f"ensure_eps_current: {len(targets)}/{len(stocks)} stock(s) need EPS update")
    from app.services import setup_progress as _prog
    _prog.begin("eps", total=len(targets))
    success = 0
    failed: list[str] = []
    for i, s in enumerate(targets):
        symbol = s["symbol"]
        _prog.update(current=i + 1, symbol=symbol, name=s["name"])
        logger.info(f"  [{i+1}/{len(targets)}] {symbol} {s['name']}")
        try:
            annual, quarterly, info = fetch_eps_for_stock(symbol)
            if annual is None and quarterly is None:
                failed.append(symbol)
                continue
            n_ann, n_qtr = upsert_eps(symbol, annual, quarterly)
            if info:
                upsert_metadata(symbol, info)
            if n_ann == 0 and n_qtr == 0:
                logger.info(f"  – {symbol}: statements returned but no EPS rows")
                failed.append(symbol)
            else:
                logger.info(f"  ✓ {symbol}: {n_ann} annual + {n_qtr} quarterly EPS rows + forecast")
                success += 1
        except Exception as e:
            logger.error(f"  ✗ {symbol}: {e}")
            failed.append(symbol)
        time.sleep(random.uniform(1.5, 3.0))

    logger.info(f"ensure_eps_current done: {success} updated, {len(failed)} failed: {failed}")
    return {"targets": len(targets), "success": success, "failed": failed}


def fetch_logos_from_tradingview() -> dict:
    """
    Batch-fetch logo_ids from TradingView scanner API for all stocks in DB.
    Only fetches for stocks missing logo_id. Updates stocks table.
    """
    import requests
    import urllib3
    urllib3.disable_warnings()

    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT symbol FROM stocks WHERE logo_id IS NULL OR logo_id = ''"
        ).fetchall()
        missing_symbols = [r[0] for r in rows]
    finally:
        conn.close()

    if not missing_symbols:
        logger.info("fetch_logos: all stocks have logo_id")
        return {"targets": 0, "found": 0, "not_found": []}

    # TradingView doesn't know which exchange each ticker is on, so try both TWSE and TPEX
    tickers = []
    for sym in missing_symbols:
        tickers.append(f"TWSE:{sym}")
        tickers.append(f"TPEX:{sym}")

    logger.info(f"fetch_logos: querying TradingView for {len(missing_symbols)} stocks")
    try:
        r = requests.post(
            "https://scanner.tradingview.com/taiwan/scan",
            json={"symbols": {"tickers": tickers}, "columns": ["name", "logoid"]},
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=20, verify=False,
        )
        data = r.json()
    except Exception as e:
        logger.error(f"TradingView API error: {e}")
        return {"targets": len(missing_symbols), "found": 0, "error": str(e)}

    results: dict[str, str] = {}
    for item in data.get("data", []):
        ticker = item.get("s", "")
        sym = ticker.split(":")[-1]
        logo_id = (item.get("d") or [None, None])[1]
        if logo_id and sym not in results:
            results[sym] = logo_id

    conn = get_connection()
    try:
        for sym, logo_id in results.items():
            conn.execute("UPDATE stocks SET logo_id = ? WHERE symbol = ?", (logo_id, sym))
        conn.commit()
    finally:
        conn.close()

    not_found = [s for s in missing_symbols if s not in results]
    logger.info(f"fetch_logos: found {len(results)}, missing {len(not_found)}: {not_found}")
    return {"targets": len(missing_symbols), "found": len(results), "not_found": not_found}


def update_all_stocks(period: str = "5y"):
    """Fetch all stocks from yfinance and update DB. Used for init and daily update."""
    stocks = load_stocks_json()
    success = 0
    failed = []

    for i, s in enumerate(stocks):
        symbol = s["symbol"]
        logger.info(f"[{i+1}/{len(stocks)}] Fetching {symbol} {s['name']}")
        try:
            df, info = fetch_yfinance(symbol, period)
            if df is not None and not df.empty:
                upsert_klines(symbol, df)
                upsert_metadata(symbol, info)
                success += 1
            else:
                logger.warning(f"No data for {symbol}")
                failed.append(symbol)
        except Exception as e:
            logger.error(f"Error processing {symbol}: {e}")
            failed.append(symbol)
        # Polite delay — longer for 5y requests to avoid Yahoo rate limits
        time.sleep(random.uniform(2.0, 4.0))

    logger.info(f"Update complete: {success} success, {len(failed)} failed: {failed}")
    return {"success": success, "failed": failed}
