"""
處置股 (disciplinary stock) tracker.

Pulls active disposal announcements from TWSE and TPEx daily and caches them
in `disposed_stocks`. A stock is considered "processing" when today's date
falls inside its disposal period.
"""
import logging
import re
from datetime import date, datetime, timedelta

import requests
import urllib3

from app.database import get_connection

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
logger = logging.getLogger(__name__)

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}


def _parse_roc_range(raw: str) -> tuple[str, str] | None:
    """
    Convert '115/04/17～115/04/30' → ('2026-04-17', '2026-04-30').
    Handles both '～' and '~' separators.
    """
    if not raw:
        return None
    parts = re.split(r"[～~]", raw.strip())
    if len(parts) != 2:
        return None
    out = []
    for p in parts:
        m = re.match(r"(\d{2,3})/(\d{1,2})/(\d{1,2})", p.strip())
        if not m:
            return None
        y = int(m.group(1)) + 1911
        out.append(f"{y:04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}")
    return (out[0], out[1])


# ── Data sources ──────────────────────────────────────────────────────────────

def _fetch_twse() -> list[dict]:
    """TWSE 注意/處置公告 (last 60 days)."""
    try:
        r = requests.get(
            "https://www.twse.com.tw/rwd/zh/announcement/punish",
            params={"response": "json"},
            headers=HEADERS, timeout=15, verify=False,
        )
        data = r.json()
        if data.get("stat") != "OK":
            return []
        out = []
        for row in data.get("data", []):
            if len(row) < 8:
                continue
            symbol = str(row[2]).strip()
            if not symbol or not symbol.isdigit():
                continue  # Skip ETNs / warrants (they have alphanumeric codes)
            if len(symbol) > 4:
                continue  # 4-digit TW stocks only
            name = str(row[3]).strip()
            period = str(row[6]).strip()
            measure = str(row[7]).strip()
            reason = str(row[5]).strip() if len(row) > 5 else ''
            date_range = _parse_roc_range(period)
            if not date_range:
                continue
            start, end = date_range
            out.append({
                "symbol": symbol,
                "name": name,
                "reason": reason,
                "measure": measure,
                "start_date": start,
                "end_date": end,
                "source": "TWSE",
            })
        return out
    except Exception as e:
        logger.warning(f"_fetch_twse: {e}")
        return []


def _fetch_tpex() -> list[dict]:
    """
    TPEx 處置公告. Endpoint changed a few times; we try the most recent one
    and fall back silently on failure (TWSE covers most active names anyway).
    """
    try:
        r = requests.get(
            "https://www.tpex.org.tw/www/zh-tw/bulletin/disposal",
            params={"response": "json"},
            headers={**HEADERS, "Referer": "https://www.tpex.org.tw"},
            timeout=15, verify=False,
        )
        if r.status_code != 200:
            return []
        data = r.json() if r.headers.get("content-type", "").lower().startswith("application/json") else None
        if not isinstance(data, dict):
            return []
        tables = data.get("tables") or []
        if not tables:
            return []
        rows = tables[0].get("data") or []
        out = []
        for row in rows:
            if not isinstance(row, list) or len(row) < 5:
                continue
            # Layout: [date, symbol, name, ..., period]
            symbol = str(row[1]).strip()
            if not symbol.isdigit() or len(symbol) != 4:
                continue
            name = str(row[2]).strip()
            # Find first string matching a date range
            period = next((str(c) for c in row if re.search(r"\d{2,3}/\d{1,2}/\d{1,2}[～~]\d{2,3}/\d{1,2}/\d{1,2}", str(c))), "")
            date_range = _parse_roc_range(period)
            if not date_range:
                continue
            out.append({
                "symbol": symbol,
                "name": name,
                "reason": "",
                "measure": "處置",
                "start_date": date_range[0],
                "end_date":   date_range[1],
                "source": "TPEx",
            })
        return out
    except Exception as e:
        logger.info(f"_fetch_tpex (non-critical): {e}")
        return []


# ── Refresh + query ───────────────────────────────────────────────────────────

def refresh_disposal_list() -> dict:
    """Fetch latest disposal announcements and replace the cache."""
    twse = _fetch_twse()
    tpex = _fetch_tpex()
    rows = twse + tpex

    conn = get_connection()
    try:
        conn.execute("DELETE FROM disposed_stocks")
        for r in rows:
            conn.execute(
                """INSERT OR REPLACE INTO disposed_stocks
                   (symbol, name, reason, measure, start_date, end_date, source, fetched_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (r["symbol"], r["name"], r["reason"], r["measure"],
                 r["start_date"], r["end_date"], r["source"],
                 datetime.now().isoformat()),
            )
        conn.commit()
    finally:
        conn.close()
    logger.info(f"refresh_disposal_list: TWSE={len(twse)} + TPEx={len(tpex)} = {len(rows)}")
    return {"twse": len(twse), "tpex": len(tpex), "total": len(rows)}


def get_active_disposal_map(today: date | None = None) -> dict[str, dict]:
    """Return {symbol: disposal_info} for all currently-active disposal stocks."""
    if today is None:
        today = date.today()
    today_s = today.isoformat()
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT symbol, name, reason, measure, start_date, end_date, source
               FROM disposed_stocks
               WHERE start_date <= ? AND end_date >= ?""",
            (today_s, today_s),
        ).fetchall()
    finally:
        conn.close()
    # A stock might appear multiple times (累計處置) — keep the one that ends
    # latest so we show the most severe current action.
    out: dict[str, dict] = {}
    for r in rows:
        d = dict(r)
        existing = out.get(d["symbol"])
        if not existing or d["end_date"] > existing["end_date"]:
            out[d["symbol"]] = d
    return out


def ensure_disposal_current(max_age_hours: float = 12.0) -> dict:
    """Refresh if the cache is older than max_age_hours or empty."""
    conn = get_connection()
    try:
        row = conn.execute("SELECT MAX(fetched_at) FROM disposed_stocks").fetchone()
        latest = row[0] if row else None
    finally:
        conn.close()
    if latest:
        try:
            age_h = (datetime.now() - datetime.fromisoformat(latest)).total_seconds() / 3600
        except Exception:
            age_h = 999
        if age_h < max_age_hours:
            return {"skipped": True, "age_hours": round(age_h, 1)}
    return refresh_disposal_list()
