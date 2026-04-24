"""
Nasdaq.com historical-quotes service — free, keyless, covers NYSE+Nasdaq.

yfinance hammers Yahoo and gets rate-limited within minutes when fetching
thousands of US symbols at once. Nasdaq's public JSON endpoint (used by their
own web charts) has no auth, no captcha, and serves 5+ years in a single call.

Endpoint:
  https://api.nasdaq.com/api/quote/{SYMBOL}/historical
    ?assetclass=stocks&fromdate=YYYY-MM-DD&todate=YYYY-MM-DD&limit=9999

Requires a browser-ish User-Agent — empty UA gets dropped at the edge.

Returned row: {date: "MM/DD/YYYY", close: "$123.45", open, high, low, volume}
We coerce to the same pandas shape yfinance produces (Open/High/Low/Close/
Volume columns, DatetimeIndex) so callers can treat us as a drop-in.
"""
import logging
from datetime import datetime, timedelta

import pandas as pd
import requests

logger = logging.getLogger(__name__)

BASE_URL = "https://api.nasdaq.com/api/quote/{symbol}/historical"
DEFAULT_TIMEOUT = 20
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
}


def _parse_money(s: str | None) -> float | None:
    """'$123.45' or '1,234.56' → 123.45 / 1234.56."""
    if not s:
        return None
    try:
        return float(s.replace("$", "").replace(",", "").strip())
    except (ValueError, AttributeError):
        return None


def _parse_int(s: str | None) -> int:
    if not s:
        return 0
    try:
        return int(s.replace(",", "").strip())
    except (ValueError, AttributeError):
        return 0


def fetch_klines(symbol: str, start: str, end: str) -> pd.DataFrame | None:
    """
    Fetch daily OHLCV for [start, end] (both YYYY-MM-DD, inclusive).
    Returns DataFrame with Open/High/Low/Close/Volume columns, DatetimeIndex
    (chronological ascending), or None on failure.
    """
    url = BASE_URL.format(symbol=symbol.upper())
    params = {
        "assetclass": "stocks",
        "fromdate": start,
        "todate": end,
        "limit": 9999,
    }
    try:
        r = requests.get(url, params=params, headers=HEADERS, timeout=DEFAULT_TIMEOUT)
        r.raise_for_status()
        j = r.json()
    except Exception as e:
        logger.warning(f"nasdaq {symbol} [{start}..{end}] error: {e}")
        return None

    status = (j or {}).get("status", {})
    if status.get("rCode") != 200:
        # Delisted / unknown / asset-class mismatch → silent fail, no retry
        logger.debug(f"nasdaq {symbol}: {status.get('bCodeMessage')}")
        return None

    rows = (((j.get("data") or {}).get("tradesTable") or {}).get("rows")) or []
    if not rows:
        return None

    records = []
    for row in rows:
        try:
            dt = datetime.strptime(row["date"], "%m/%d/%Y")
        except (ValueError, KeyError):
            continue
        close = _parse_money(row.get("close"))
        if close is None:
            continue
        records.append({
            "date": dt,
            "Open":   _parse_money(row.get("open"))  or close,
            "High":   _parse_money(row.get("high"))  or close,
            "Low":    _parse_money(row.get("low"))   or close,
            "Close":  close,
            "Volume": _parse_int(row.get("volume")),
        })

    if not records:
        return None

    df = pd.DataFrame(records).set_index("date").sort_index()
    df.index.name = "Date"
    return df


def fetch_klines_period(symbol: str, period: str = "5y") -> pd.DataFrame | None:
    """Convenience wrapper — fetch the last N years up to today."""
    years = {"1y": 1, "2y": 2, "3y": 3, "5y": 5, "10y": 10}.get(period, 5)
    end = datetime.now().date()
    start = end - timedelta(days=years * 366 + 5)  # +5 slack for leap/weekends
    return fetch_klines(symbol, start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d"))
