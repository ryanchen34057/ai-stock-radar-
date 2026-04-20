"""
TWSE MIS (Market Information System) — intraday real-time quotes.

Free endpoint, no API key required. Polite cadence: <= once per 5 min per
symbol. Returns latest trade price, previous close, volume for Taiwan stocks
(both 上市 TSE and 上櫃 OTC).

Endpoint format:
    https://mis.twse.com.tw/stock/api/getStockInfo.jsp
        ?ex_ch=tse_2330.tw|otc_6488.tw|...
        &json=1&delay=0

Response (relevant fields):
    msgArray[*].c    = stock code
    msgArray[*].n    = name
    msgArray[*].z    = latest trade price ("-" if no trade yet)
    msgArray[*].y    = previous close
    msgArray[*].o    = open
    msgArray[*].h    = high
    msgArray[*].l    = low
    msgArray[*].v    = accumulated volume (張/lots)
    msgArray[*].ex   = "tse" | "otc"
    msgArray[*].d    = date YYYYMMDD
    msgArray[*].t    = time HH:MM:SS
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime
from typing import Any

import requests

from app.database import get_connection

logger = logging.getLogger(__name__)

MIS_URL = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp"
BATCH_SIZE = 80  # MIS accepts ~100 reliably; pad for the tse+otc doubling
REQUEST_TIMEOUT = 10

# In-memory cache: { symbol: { price, prev_close, change, change_pct,
#                              volume, fetched_at_epoch, market } }
_cache: dict[str, dict[str, Any]] = {}
_cache_lock = threading.Lock()


def _load_all_symbols() -> list[str]:
    """Return every enabled stock symbol from the DB."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT symbol FROM stocks WHERE enabled = 1 ORDER BY symbol"
        ).fetchall()
    finally:
        conn.close()
    return [r["symbol"] for r in rows]


def _parse_float(s: Any) -> float | None:
    if s is None:
        return None
    s = str(s).strip()
    if not s or s == "-":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _parse_int(s: Any) -> int | None:
    v = _parse_float(s)
    return int(v) if v is not None else None


def _fetch_batch(ex_ch_list: list[str]) -> list[dict]:
    """Fetch one batch of ex_ch entries from MIS. Returns msgArray items."""
    if not ex_ch_list:
        return []
    params = {
        "ex_ch": "|".join(ex_ch_list),
        "json": 1,
        "delay": 0,
        "_": int(time.time() * 1000),
    }
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Referer": "https://mis.twse.com.tw/stock/fibest.jsp",
    }
    r = requests.get(MIS_URL, params=params, headers=headers, timeout=REQUEST_TIMEOUT)
    r.raise_for_status()
    data = r.json()
    return data.get("msgArray", []) or []


def refresh_all_quotes() -> dict:
    """
    Pull live quotes for every enabled stock. We query each symbol as BOTH
    tse_XXXX.tw and otc_XXXX.tw — MIS only returns the one that actually
    exists, so we don't need a per-symbol market flag.
    """
    symbols = _load_all_symbols()
    if not symbols:
        return {"fetched": 0, "errors": 0}

    # Build ex_ch strings doubled (tse + otc per symbol). A batch of
    # BATCH_SIZE doubled entries ≈ BATCH_SIZE/2 symbols.
    doubled: list[str] = []
    for sym in symbols:
        doubled.append(f"tse_{sym}.tw")
        doubled.append(f"otc_{sym}.tw")

    now_epoch = int(time.time())
    fetched = 0
    errors = 0
    new_cache: dict[str, dict[str, Any]] = {}

    for i in range(0, len(doubled), BATCH_SIZE):
        chunk = doubled[i:i + BATCH_SIZE]
        try:
            items = _fetch_batch(chunk)
        except Exception as e:
            logger.warning(f"MIS batch {i//BATCH_SIZE} failed: {e}")
            errors += 1
            continue

        for it in items:
            sym = (it.get("c") or "").strip()
            if not sym:
                continue
            price      = _parse_float(it.get("z"))
            prev_close = _parse_float(it.get("y"))
            change = change_pct = None
            if price is not None and prev_close:
                change     = round(price - prev_close, 2)
                change_pct = round(change / prev_close * 100, 2)
            new_cache[sym] = {
                "price": price,
                "prev_close": prev_close,
                "change": change,
                "change_pct": change_pct,
                "open": _parse_float(it.get("o")),
                "high": _parse_float(it.get("h")),
                "low": _parse_float(it.get("l")),
                "volume": _parse_int(it.get("v")),
                "market": it.get("ex"),                  # "tse" / "otc"
                "trade_date": it.get("d"),               # YYYYMMDD
                "trade_time": it.get("t"),               # HH:MM:SS
                "fetched_at": now_epoch,
            }
            fetched += 1

        # Small delay between batches — be polite to TWSE
        time.sleep(0.3)

    with _cache_lock:
        _cache.clear()
        _cache.update(new_cache)

    logger.info(f"TWSE MIS: refreshed {fetched} quotes in {len(doubled)//BATCH_SIZE + 1} batches, {errors} batch errors")
    return {
        "fetched": fetched,
        "errors": errors,
        "symbols": len(symbols),
        "refreshed_at": datetime.now().isoformat(),
    }


def get_quote(symbol: str) -> dict | None:
    """Return the cached quote for one symbol (or None if not cached)."""
    with _cache_lock:
        q = _cache.get(symbol)
        return dict(q) if q else None


def get_all_quotes() -> dict[str, dict]:
    """Return a snapshot of all cached quotes."""
    with _cache_lock:
        return {k: dict(v) for k, v in _cache.items()}


def cache_size() -> int:
    with _cache_lock:
        return len(_cache)
