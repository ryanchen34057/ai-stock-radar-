"""
Market indices tracker — TAIEX, SOX, Dow, NASDAQ, S&P 500, Nikkei, Hang Seng.
Daily OHLCV (and volume where yfinance provides it) stored weekly-ish into
its own SQLite table, served to the dashboard widget above the filters.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

import pandas as pd
import yfinance as yf

from app.database import get_connection

logger = logging.getLogger(__name__)

# yfinance_ticker → (display_code, zh_name, emoji) in display order
INDICES: list[tuple[str, str, str, str]] = [
    ("^TWII", "TAIEX",     "台股加權",   "🇹🇼"),
    ("^TWOII","TPEx",      "櫃買指數",   "📊"),
    ("^SOX",  "SOX",       "費半",       "💻"),
    ("^IXIC", "NASDAQ",    "那斯達克",   "🚀"),
    ("^GSPC", "S&P 500",   "標普 500",   "📈"),
    ("^DJI",  "DJI",       "道瓊工業",   "🏛️"),
    ("^N225", "NIKKEI",    "日經 225",   "🇯🇵"),
    ("^HSI",  "HSI",       "恆生指數",   "🇭🇰"),
]

# ── DB ──────────────────────────────────────────────────────────────────────
def init_indices_schema():
    conn = get_connection()
    try:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS indices_klines (
                symbol TEXT, date TEXT,
                open REAL, high REAL, low REAL, close REAL,
                volume INTEGER DEFAULT 0,
                PRIMARY KEY (symbol, date)
            );
            CREATE TABLE IF NOT EXISTS indices_meta (
                symbol         TEXT PRIMARY KEY,
                display_code   TEXT,
                name_zh        TEXT,
                emoji          TEXT,
                last_close     REAL,
                prev_close     REAL,
                change_pct     REAL,
                last_date      TEXT,
                last_updated   TEXT
            );
        """)
        conn.commit()
    finally:
        conn.close()


# ── Fetch ───────────────────────────────────────────────────────────────────
def fetch_index(symbol: str, period: str = "5y") -> pd.DataFrame | None:
    try:
        t = yf.Ticker(symbol)
        h = t.history(period=period)
        if h.empty:
            logger.warning(f"indices: {symbol} returned empty")
            return None
        return h
    except Exception as e:
        logger.warning(f"indices: {symbol} failed: {e}")
        return None


def upsert_index(symbol: str, display_code: str, name_zh: str, emoji: str, df: pd.DataFrame):
    now = datetime.now().isoformat()
    rows = []
    for d, r in df.iterrows():
        date_str = d.strftime("%Y-%m-%d") if hasattr(d, "strftime") else str(d)[:10]
        try:
            vol = int(r["Volume"]) if not pd.isna(r["Volume"]) else 0
        except Exception:
            vol = 0
        rows.append((symbol, date_str, float(r["Open"]), float(r["High"]),
                     float(r["Low"]), float(r["Close"]), vol))

    if not rows:
        return

    last_close = rows[-1][5]
    prev_close = rows[-2][5] if len(rows) >= 2 else last_close
    change_pct = round((last_close - prev_close) / prev_close * 100, 2) if prev_close else 0
    last_date = rows[-1][1]

    conn = get_connection()
    try:
        conn.executemany(
            """INSERT OR REPLACE INTO indices_klines
               (symbol, date, open, high, low, close, volume)
               VALUES (?,?,?,?,?,?,?)""",
            rows,
        )
        conn.execute(
            """INSERT OR REPLACE INTO indices_meta
               (symbol, display_code, name_zh, emoji,
                last_close, prev_close, change_pct, last_date, last_updated)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (symbol, display_code, name_zh, emoji,
             last_close, prev_close, change_pct, last_date, now),
        )
        conn.commit()
    finally:
        conn.close()


def refresh_all_indices(period: str = "5y") -> dict:
    """Fetch every tracked index via yfinance and persist."""
    init_indices_schema()
    ok = 0
    failed: list[str] = []
    for symbol, display_code, name_zh, emoji in INDICES:
        df = fetch_index(symbol, period)
        if df is None:
            failed.append(symbol)
            continue
        try:
            upsert_index(symbol, display_code, name_zh, emoji, df)
            ok += 1
            logger.info(f"indices: {symbol} upserted {len(df)} rows")
        except Exception as e:
            logger.warning(f"indices: {symbol} upsert failed: {e}")
            failed.append(symbol)
    return {"ok": ok, "failed": failed, "total": len(INDICES)}


# ── Read ────────────────────────────────────────────────────────────────────
def get_indices_data(days: int = 90) -> list[dict]:
    """Return the ordered list of indices with their recent klines."""
    conn = get_connection()
    try:
        meta_rows = conn.execute(
            """SELECT symbol, display_code, name_zh, emoji,
                      last_close, prev_close, change_pct, last_date
               FROM indices_meta"""
        ).fetchall()
        meta_map: dict[str, dict] = {r["symbol"]: dict(r) for r in meta_rows}

        out = []
        for symbol, display_code, name_zh, emoji in INDICES:
            m = meta_map.get(symbol)
            if not m:
                continue
            rows = conn.execute(
                """SELECT date, open, high, low, close, volume
                   FROM indices_klines
                   WHERE symbol = ?
                   ORDER BY date DESC LIMIT ?""",
                (symbol, days),
            ).fetchall()
            klines = list(reversed([dict(r) for r in rows]))
            out.append({**m, "klines": klines})
        return out
    finally:
        conn.close()
