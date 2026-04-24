"""
TDCC 集保 weekly 股權分散 — tracks 千張大戶 (holders of 1,000+ 張 / 1M+ shares).

Data source: TDCC opendata bulk CSV
    https://smart.tdcc.com.tw/opendata/getOD.ashx?id=1-5

Published every Friday with that week's snapshot. The CSV contains all
listed + OTC symbols, 17 持股分級 rows each. Level 15 = 1,000,001 shares
and above = "千張大戶". Level 17 is the total line.

We fetch the latest bulk CSV once per refresh (~2.3 MB), extract just the
level-15 row for each symbol we track, and store (symbol, date, count, pct)
into shareholding_weekly. Change percent is computed at read time from the
latest two snapshots.
"""
from __future__ import annotations

import csv
import io
import logging
from typing import Iterator

import requests
import urllib3

from app.database import get_connection

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
logger = logging.getLogger(__name__)

CSV_URL = "https://smart.tdcc.com.tw/opendata/getOD.ashx?id=1-5"
BIG_HOLDER_LEVEL = "15"  # 1,000,001 shares and above
HEADERS = {"User-Agent": "Mozilla/5.0"}


def _parse_rows(csv_text: str) -> Iterator[tuple[str, str, int, float]]:
    """Yield (symbol, date, count, pct) for every level-15 row in the CSV."""
    reader = csv.reader(io.StringIO(csv_text))
    next(reader, None)  # skip header
    for row in reader:
        if len(row) < 6:
            continue
        date = row[0].strip()
        symbol = row[1].strip()
        level = row[2].strip()
        if level != BIG_HOLDER_LEVEL:
            continue
        # Only 4-digit listed symbols (skip warrants / ETNs with 6-digit codes)
        if not symbol.isdigit() or len(symbol) != 4:
            continue
        try:
            count = int(row[3].strip() or 0)
            pct = float(row[5].strip() or 0)
        except ValueError:
            continue
        yield symbol, date, count, pct


def refresh_shareholding_weekly() -> dict:
    """Pull the latest bulk CSV and upsert level-15 rows for all tracked symbols."""
    try:
        r = requests.get(CSV_URL, headers=HEADERS, timeout=30, verify=False)
        if r.status_code != 200:
            logger.warning(f"TDCC CSV HTTP {r.status_code}")
            return {"status": "fail", "reason": f"http_{r.status_code}"}
    except Exception as e:
        logger.warning(f"TDCC CSV fetch error: {e}")
        return {"status": "fail", "reason": str(e)}

    # Limit writes to symbols we actually track in the dashboard
    conn = get_connection()
    try:
        # TDCC 千張大戶 data only exists for Taiwan listings.
        tracked = {r["symbol"] for r in conn.execute(
            "SELECT symbol FROM stocks WHERE enabled = 1 AND market = 'TW'"
        ).fetchall()}
    finally:
        conn.close()

    rows = [
        (sym, date, count, pct)
        for sym, date, count, pct in _parse_rows(r.text)
        if sym in tracked
    ]
    if not rows:
        logger.warning("TDCC CSV: no level-15 rows matched tracked symbols")
        return {"status": "fail", "reason": "no_matched_rows"}

    conn = get_connection()
    try:
        conn.executemany(
            """INSERT OR REPLACE INTO shareholding_weekly
               (symbol, date, big_holder_count, big_holder_pct)
               VALUES (?, ?, ?, ?)""",
            rows,
        )
        conn.commit()
    finally:
        conn.close()

    latest_date = rows[0][1]
    logger.info(f"shareholding: wrote {len(rows)} rows for date {latest_date}")
    return {"status": "ok", "rows": len(rows), "date": latest_date}


def get_latest_per_symbol() -> dict[str, dict]:
    """
    Return {symbol: {date, count, pct, prev_date, prev_count, prev_pct,
                     count_change_pct}} — the most recent snapshot for each
    symbol, with diff vs the second-latest.
    count_change_pct is (new - prev) / prev * 100, signed (+ = 大戶增加).
    """
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT symbol, date, big_holder_count, big_holder_pct
               FROM shareholding_weekly
               ORDER BY symbol, date DESC"""
        ).fetchall()
    finally:
        conn.close()

    out: dict[str, dict] = {}
    # rows are grouped by symbol (ORDER BY symbol, date DESC)
    for r in rows:
        sym = r["symbol"]
        entry = out.get(sym)
        if entry is None:
            # First (latest) row for this symbol
            out[sym] = {
                "date": r["date"],
                "count": r["big_holder_count"],
                "pct": r["big_holder_pct"],
                "prev_date": None,
                "prev_count": None,
                "prev_pct": None,
                "count_change_pct": None,
                "pct_change": None,
            }
        elif entry["prev_date"] is None:
            # Second row = previous snapshot
            entry["prev_date"] = r["date"]
            entry["prev_count"] = r["big_holder_count"]
            entry["prev_pct"] = r["big_holder_pct"]
            prev = r["big_holder_count"]
            if prev and prev > 0:
                entry["count_change_pct"] = round(
                    (entry["count"] - prev) / prev * 100, 2
                )
            entry["pct_change"] = round(entry["pct"] - r["big_holder_pct"], 2)
    return out
