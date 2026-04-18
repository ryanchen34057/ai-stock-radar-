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
                """INSERT OR IGNORE INTO stocks (symbol, name, layer, layer_name, sub_category, note)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (s["symbol"], s["name"], s["layer"], s["layer_name"],
                 s.get("sub_category"), s.get("note"))
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

            result.append({
                "symbol": symbol,
                "name": stock["name"],
                "layer": stock["layer"],
                "layer_name": stock["layer_name"],
                "sub_category": stock["sub_category"],
                "note": stock["note"],
                "current_price": current_price,
                "change": change,
                "change_percent": change_pct,
                "volume": current["volume"] if current else None,
                "pe_ratio": dict(meta)["pe_ratio"] if meta else None,
                "market_cap": dict(meta)["market_cap"] if meta else None,
                "ma": ma_values,
                "klines": klines_display,
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
