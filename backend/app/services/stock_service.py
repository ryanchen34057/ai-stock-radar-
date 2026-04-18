import yfinance as yf
import pandas as pd
import sqlite3
import json
import logging
import time
import random
from pathlib import Path
from datetime import datetime, timezone
from app.database import get_connection, DB_PATH

logger = logging.getLogger(__name__)

STOCKS_JSON = Path(__file__).parent.parent.parent / "data" / "stocks.json"


def load_stocks_json() -> list[dict]:
    with open(STOCKS_JSON, encoding="utf-8") as f:
        return json.load(f)


def seed_stocks_table():
    """Insert stocks from stocks.json into DB if not present."""
    stocks = load_stocks_json()
    conn = get_connection()
    try:
        for s in stocks:
            conn.execute(
                """INSERT OR IGNORE INTO stocks (symbol, name, layer, layer_name, sub_category, note, theme, themes, industry_role, secondary_layers)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (s["symbol"], s["name"], s["layer"], s["layer_name"],
                 s.get("sub_category"), s.get("note"),
                 s.get("theme", "A"),
                 json.dumps(s["themes"]) if s.get("themes") else None,
                 s.get("industry_role"),
                 json.dumps(s["secondary_layers"]) if s.get("secondary_layers") else None)
            )
        # Update cross-theme flags + industry_role + secondary_layers for stocks already in DB
        for s in stocks:
            if s.get("themes") or s.get("industry_role") or s.get("secondary_layers"):
                conn.execute(
                    "UPDATE stocks SET theme=?, themes=?, industry_role=?, secondary_layers=? WHERE symbol=?",
                    (s.get("theme", "A"),
                     json.dumps(s["themes"]) if s.get("themes") else None,
                     s.get("industry_role"),
                     json.dumps(s["secondary_layers"]) if s.get("secondary_layers") else None,
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
    """Save PE and market cap to metadata table."""
    pe = info.get("trailingPE") or info.get("forwardPE")
    cap = info.get("marketCap")
    now = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        conn.execute(
            """INSERT OR REPLACE INTO metadata (symbol, pe_ratio, market_cap, last_updated)
               VALUES (?, ?, ?, ?)""",
            (symbol, pe, cap, now)
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
    conn = get_connection()
    try:
        stocks_rows = conn.execute(
            "SELECT * FROM stocks ORDER BY layer, symbol"
        ).fetchall()

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

            # Last 60 for display
            klines_display = klines_all[-60:] if len(klines_all) > 60 else klines_all

            closes = [k["close"] for k in klines_all]
            current = klines_all[-1] if klines_all else None
            prev = klines_all[-2] if len(klines_all) >= 2 else None

            current_price = current["close"] if current else None
            change = None
            change_pct = None
            if current and prev and prev["close"]:
                change = round(current["close"] - prev["close"], 2)
                change_pct = round(change / prev["close"] * 100, 2)

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
                "current_price": current_price,
                "change": change,
                "change_percent": change_pct,
                "volume": current["volume"] if current else None,
                "pe_ratio": dict(meta)["pe_ratio"] if meta else None,
                "market_cap": dict(meta)["market_cap"] if meta else None,
                "ma": ma_values,
                "klines": klines_display,
                "is_20d_high": is_20d_high,
                "is_all_time_high": is_all_time_high,
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
    Fetch 5y klines for stocks with incomplete data.
    - min_rows=1 (default): only stocks with NO klines (used at startup for new stocks)
    - min_rows=1000: re-fetch stocks with less than ~4 years of data

    Newly-listed stocks (IPO < 5y ago) are detected by earliest kline date and skipped
    — we assume yfinance has already given us everything available.
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

    # If first kline is within 60 days of "5y ago", we already have max available
    cutoff = (_dt.now() - _td(days=5 * 365 - 60)).strftime("%Y-%m-%d")

    targets = []
    for s in stocks:
        sym = s["symbol"]
        n = counts.get(sym, 0)
        if n >= min_rows:
            continue
        first = earliest.get(sym)
        if first and first <= cutoff:
            # Has data going back ~5y already — probably max available, skip
            logger.debug(f"  skip {sym}: {n} rows but earliest={first} (likely max)")
            continue
        targets.append(s)
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
