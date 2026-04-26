"""1-minute intraday bar service — used by the dashboard's 覆盤 (replay) UI.

yfinance gives us 1-minute history for the last ~7 trading days at no cost.
We cache each (symbol, date) bundle in a tiny SQLite table so a re-open of
the same replay doesn't re-hit yfinance — which has aggressive crumb-based
rate limiting.

Public API:
    list_available_dates(symbol, market) -> list[str]   # YYYY-MM-DD descending
    get_intraday_bars(symbol, market, date_str)         # one trading day
"""
from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime, timedelta, timezone

import yfinance as yf

from app.database import get_connection

logger = logging.getLogger(__name__)


def _yf_symbol(symbol: str, market: str) -> str:
    """Match the suffix convention used by stock_service.py."""
    if market.upper() == "US":
        return symbol
    # TW: try .TW first, callers that want .TWO can pass it explicitly
    return f"{symbol}.TW" if "." not in symbol else symbol


def _ensure_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """CREATE TABLE IF NOT EXISTS intraday_cache (
              symbol     TEXT NOT NULL,
              date       TEXT NOT NULL,
              market     TEXT NOT NULL DEFAULT 'TW',
              fetched_at TEXT NOT NULL,
              bars_json  TEXT NOT NULL,
              PRIMARY KEY (symbol, date)
           )"""
    )
    conn.commit()


def _df_to_bars(df) -> list[dict]:
    """Convert a yfinance 1-min history DataFrame into a JSON-friendly list.

    Times are emitted as ISO 8601 strings in their native exchange tz so the
    frontend can show '09:00 / 09:30' without needing tz-conversion logic.
    """
    out: list[dict] = []
    if df is None or len(df) == 0:
        return out
    for ts, row in df.iterrows():
        # Drop bars where any OHLC is NaN (yfinance pads gaps with NaNs)
        if any(row[c] != row[c] for c in ("Open", "High", "Low", "Close")):  # NaN check
            continue
        out.append({
            "time": ts.strftime("%Y-%m-%dT%H:%M:%S"),
            "open":  float(row["Open"]),
            "high":  float(row["High"]),
            "low":   float(row["Low"]),
            "close": float(row["Close"]),
            "volume": int(row["Volume"]) if row["Volume"] == row["Volume"] else 0,
        })
    return out


def _fetch_one_day(symbol: str, market: str, date_str: str) -> list[dict]:
    """Fetch a single trading day's 1-minute bars from yfinance."""
    yf_sym = _yf_symbol(symbol, market)
    target = datetime.strptime(date_str, "%Y-%m-%d")
    next_day = target + timedelta(days=1)
    # yfinance's 1m endpoint accepts start/end (UTC midnights work fine; the
    # exchange tz lookup is internal). Pull a 2-day window to make sure we
    # cover the whole session even with tz quirks.
    try:
        df = yf.Ticker(yf_sym).history(
            start=target.strftime("%Y-%m-%d"),
            end=next_day.strftime("%Y-%m-%d"),
            interval="1m",
            auto_adjust=False,
        )
    except Exception as e:
        logger.warning("intraday yfinance fail %s %s: %s", yf_sym, date_str, e)
        return []

    if (df is None or len(df) == 0) and market.upper() == "TW" and not symbol.endswith(".TW"):
        # Try .TWO (上櫃) fallback
        try:
            df = yf.Ticker(f"{symbol}.TWO").history(
                start=target.strftime("%Y-%m-%d"),
                end=next_day.strftime("%Y-%m-%d"),
                interval="1m",
                auto_adjust=False,
            )
        except Exception:
            df = None

    bars = _df_to_bars(df)
    # Filter to that date only (defensive — the start/end window is exclusive
    # but tz boundaries can sometimes pull in bars from the next session).
    bars = [b for b in bars if b["time"][:10] == date_str]
    return bars


def get_intraday_bars(symbol: str, market: str, date_str: str | None = None,
                      use_cache: bool = True) -> dict:
    """Return {date, bars, source} for the requested trading day.

    If date_str is None, picks the most recent date that yfinance has data
    for (usually 'today during market hours' or 'last close'). Cache hit on
    same-day requests is suppressed so an in-progress trading day stays
    fresh; historical replays serve from the cache.
    """
    today_iso = datetime.now().strftime("%Y-%m-%d")
    target_date = date_str

    conn = get_connection()
    try:
        _ensure_table(conn)

        if use_cache and target_date and target_date != today_iso:
            row = conn.execute(
                "SELECT bars_json FROM intraday_cache WHERE symbol = ? AND date = ?",
                (symbol, target_date),
            ).fetchone()
            if row:
                bars = json.loads(row["bars_json"])
                if bars:
                    return {"date": target_date, "bars": bars, "source": "cache"}

        # Cache miss (or live day) — fetch fresh.
        if target_date is None:
            # Try last 5 calendar days, newest first.
            for delta in range(5):
                d = (datetime.now() - timedelta(days=delta)).strftime("%Y-%m-%d")
                bars = _fetch_one_day(symbol, market, d)
                if bars:
                    target_date = d
                    break
            else:
                return {"date": None, "bars": [], "source": "empty"}
        else:
            bars = _fetch_one_day(symbol, market, target_date)

        if bars and target_date != today_iso:
            conn.execute(
                """INSERT OR REPLACE INTO intraday_cache
                   (symbol, date, market, fetched_at, bars_json)
                   VALUES (?, ?, ?, ?, ?)""",
                (symbol, target_date, market.upper(),
                 datetime.now(timezone.utc).isoformat(),
                 json.dumps(bars, separators=(",", ":"))),
            )
            conn.commit()

        return {"date": target_date, "bars": bars, "source": "yfinance"}
    finally:
        conn.close()


def list_available_dates(symbol: str, market: str) -> list[str]:
    """Return up to 7 recent trading dates that yfinance probably has data for.

    Pulls one big 7-day fetch (cheaper than per-day requests), groups bars by
    date, returns the date keys in DESC order. Cached results from prior days
    are merged in too so users see a complete picker.
    """
    yf_sym = _yf_symbol(symbol, market)
    dates: set[str] = set()

    conn = get_connection()
    try:
        _ensure_table(conn)
        # Cached dates first — these we know we can serve instantly.
        for r in conn.execute(
            "SELECT date FROM intraday_cache WHERE symbol = ? ORDER BY date DESC LIMIT 14",
            (symbol,),
        ).fetchall():
            dates.add(r["date"])
    finally:
        conn.close()

    try:
        df = yf.Ticker(yf_sym).history(period="7d", interval="1m", auto_adjust=False)
        if df is not None and len(df) > 0:
            for ts in df.index:
                dates.add(ts.strftime("%Y-%m-%d"))
    except Exception as e:
        logger.warning("intraday list_available yfinance fail %s: %s", yf_sym, e)

    return sorted(dates, reverse=True)[:14]
