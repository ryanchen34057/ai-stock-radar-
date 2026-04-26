"""Intraday bar service — used by the dashboard's 覆盤 (replay) UI.

yfinance gives us 1m history for ~7 days, 5m/15m/30m for ~60 days, and
60m for ~730 days at no cost. We cache each (symbol, date, interval)
bundle in a tiny SQLite table so a re-open of the same replay doesn't
re-hit yfinance — which has aggressive crumb-based rate limiting.

Public API:
    list_available_dates(symbol, market, interval)  # dates DESC
    get_intraday_bars(symbol, market, date_str, interval)
"""
from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime, timedelta, timezone

import yfinance as yf

from app.database import get_connection

logger = logging.getLogger(__name__)

# yfinance accepts these for intraday — we expose 1m / 5m / 15m / 30m / 60m
# in the UI. Anything outside this set is rejected at the API layer.
SUPPORTED_INTERVALS = {"1m", "5m", "15m", "30m", "60m"}


def _yf_symbol(symbol: str, market: str) -> str:
    """Match the suffix convention used by stock_service.py."""
    if market.upper() == "US":
        return symbol
    # TW: try .TW first, callers that want .TWO can pass it explicitly
    return f"{symbol}.TW" if "." not in symbol else symbol


def _ensure_table(conn: sqlite3.Connection) -> None:
    """Create the cache table; migrate from the pre-interval schema if needed.

    Old schema had PK (symbol, date) — fine for 1m only. The new schema
    keys on (symbol, date, interval) so the same day can be cached at
    multiple intervals. Cache content is regenerable, so on schema change
    we just drop and rebuild rather than copy old rows over.
    """
    cur = conn.execute("PRAGMA table_info(intraday_cache)")
    cols = [r[1] for r in cur.fetchall()]
    if cols and "interval" not in cols:
        conn.execute("DROP TABLE intraday_cache")

    conn.execute(
        """CREATE TABLE IF NOT EXISTS intraday_cache (
              symbol     TEXT NOT NULL,
              date       TEXT NOT NULL,
              interval   TEXT NOT NULL DEFAULT '1m',
              market     TEXT NOT NULL DEFAULT 'TW',
              fetched_at TEXT NOT NULL,
              bars_json  TEXT NOT NULL,
              PRIMARY KEY (symbol, date, interval)
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


def _fetch_one_day(symbol: str, market: str, date_str: str, interval: str) -> list[dict]:
    """Fetch a single trading day's bars from yfinance at the given interval."""
    yf_sym = _yf_symbol(symbol, market)
    target = datetime.strptime(date_str, "%Y-%m-%d")
    next_day = target + timedelta(days=1)
    # Pull a 2-day window so tz boundaries don't truncate the session.
    try:
        df = yf.Ticker(yf_sym).history(
            start=target.strftime("%Y-%m-%d"),
            end=next_day.strftime("%Y-%m-%d"),
            interval=interval,
            auto_adjust=False,
        )
    except Exception as e:
        logger.warning("intraday yfinance fail %s %s %s: %s", yf_sym, date_str, interval, e)
        return []

    if (df is None or len(df) == 0) and market.upper() == "TW" and not symbol.endswith(".TW"):
        # Try .TWO (上櫃) fallback
        try:
            df = yf.Ticker(f"{symbol}.TWO").history(
                start=target.strftime("%Y-%m-%d"),
                end=next_day.strftime("%Y-%m-%d"),
                interval=interval,
                auto_adjust=False,
            )
        except Exception:
            df = None

    bars = _df_to_bars(df)
    # Filter to that date only (defensive — start/end window is exclusive
    # but tz boundaries can sometimes pull in bars from the next session).
    bars = [b for b in bars if b["time"][:10] == date_str]
    return bars


def get_intraday_bars(symbol: str, market: str, date_str: str | None = None,
                      interval: str = "1m", use_cache: bool = True) -> dict:
    """Return {date, bars, source, interval} for the requested trading day.

    If date_str is None, picks the most recent date that yfinance has data
    for. Same-day cache is bypassed so an in-progress trading day stays
    fresh; historical replays serve from the cache.
    """
    if interval not in SUPPORTED_INTERVALS:
        raise ValueError(f"unsupported interval {interval!r}")
    today_iso = datetime.now().strftime("%Y-%m-%d")
    target_date = date_str

    conn = get_connection()
    try:
        _ensure_table(conn)

        if use_cache and target_date and target_date != today_iso:
            row = conn.execute(
                "SELECT bars_json FROM intraday_cache "
                "WHERE symbol = ? AND date = ? AND interval = ?",
                (symbol, target_date, interval),
            ).fetchone()
            if row:
                bars = json.loads(row["bars_json"])
                if bars:
                    return {"date": target_date, "bars": bars,
                            "source": "cache", "interval": interval}

        # Cache miss (or live day) — fetch fresh.
        if target_date is None:
            for delta in range(5):
                d = (datetime.now() - timedelta(days=delta)).strftime("%Y-%m-%d")
                bars = _fetch_one_day(symbol, market, d, interval)
                if bars:
                    target_date = d
                    break
            else:
                return {"date": None, "bars": [], "source": "empty", "interval": interval}
        else:
            bars = _fetch_one_day(symbol, market, target_date, interval)

        if bars and target_date != today_iso:
            conn.execute(
                """INSERT OR REPLACE INTO intraday_cache
                   (symbol, date, interval, market, fetched_at, bars_json)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (symbol, target_date, interval, market.upper(),
                 datetime.now(timezone.utc).isoformat(),
                 json.dumps(bars, separators=(",", ":"))),
            )
            conn.commit()

        return {"date": target_date, "bars": bars,
                "source": "yfinance", "interval": interval}
    finally:
        conn.close()


# yfinance period limits per interval (free tier).
_PERIOD_FOR_INTERVAL = {
    "1m":  "7d",
    "5m":  "60d",
    "15m": "60d",
    "30m": "60d",
    "60m": "60d",   # 730d allowed but 60d keeps the picker usable
}


def list_available_dates(symbol: str, market: str, interval: str = "1m") -> list[str]:
    """Return up to 14 recent trading dates with data at this interval.

    Pulls one period-bounded fetch per call (cheaper than per-day) and
    groups by date. Cached dates are merged in so the picker stays
    complete across past sessions.
    """
    if interval not in SUPPORTED_INTERVALS:
        raise ValueError(f"unsupported interval {interval!r}")
    yf_sym = _yf_symbol(symbol, market)
    dates: set[str] = set()

    conn = get_connection()
    try:
        _ensure_table(conn)
        for r in conn.execute(
            "SELECT date FROM intraday_cache WHERE symbol = ? AND interval = ? "
            "ORDER BY date DESC LIMIT 30",
            (symbol, interval),
        ).fetchall():
            dates.add(r["date"])
    finally:
        conn.close()

    try:
        df = yf.Ticker(yf_sym).history(
            period=_PERIOD_FOR_INTERVAL[interval],
            interval=interval,
            auto_adjust=False,
        )
        if df is not None and len(df) > 0:
            for ts in df.index:
                dates.add(ts.strftime("%Y-%m-%d"))
    except Exception as e:
        logger.warning("intraday list_available yfinance fail %s %s: %s",
                       yf_sym, interval, e)

    return sorted(dates, reverse=True)[:14]
