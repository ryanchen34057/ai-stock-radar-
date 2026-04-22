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
    """
    TWSE 處置公告 — uses the official OpenAPI endpoint, which is the
    only reliable one (the legacy /rwd/zh/announcement/punish route
    silently times out from many networks).

    Response schema (partial):
        [{
            "Code": "2498", "Name": "宏達電",
            "DispositionPeriod": "115/04/17～115/04/30",
            "DispositionMeasures": "第一次處置",
            "ReasonsOfDisposition": "連續三次",
            ...
        }, ...]
    """
    try:
        r = requests.get(
            "https://openapi.twse.com.tw/v1/announcement/punish",
            headers=HEADERS, timeout=20, verify=False,
        )
        if r.status_code != 200:
            return []
        data = r.json()
        if not isinstance(data, list):
            return []
        out = []
        for row in data:
            if not isinstance(row, dict):
                continue
            symbol = str(row.get("Code", "")).strip()
            # Pure 4-digit symbols only — skip warrants (6-digit), ETNs, etc.
            if not symbol.isdigit() or len(symbol) != 4:
                continue
            name = str(row.get("Name", "")).strip()
            period = str(row.get("DispositionPeriod", "")).strip()
            measure = str(row.get("DispositionMeasures", "")).strip()
            reason = str(row.get("ReasonsOfDisposition", "")).strip()
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
    TPEx 處置公告 — uses the TPEx OpenAPI endpoint.

    Response schema:
        [{
            "Date": "1150422",
            "SecuritiesCompanyCode": "3221", "CompanyName": "台嘉碩",
            "DispositionPeriod": "1150423~1150507",
            "DispositionReasons": "...",
            "DisposalCondition": "...",
        }, ...]

    Note DispositionPeriod here uses solid ROC format (YYYMMDD~YYYMMDD)
    without slashes — different from TWSE. We normalise both.
    """
    try:
        r = requests.get(
            "https://www.tpex.org.tw/openapi/v1/tpex_disposal_information",
            headers={**HEADERS, "Referer": "https://www.tpex.org.tw"},
            timeout=20, verify=False,
        )
        if r.status_code != 200:
            return []
        data = r.json()
        if not isinstance(data, list):
            return []
        out = []
        for row in data:
            if not isinstance(row, dict):
                continue
            symbol = str(row.get("SecuritiesCompanyCode", "")).strip()
            if not symbol.isdigit() or len(symbol) != 4:
                continue
            name = str(row.get("CompanyName", "")).strip()
            period = str(row.get("DispositionPeriod", "")).strip()
            # TPEx format "1150423~1150507" — convert to "115/4/23～115/5/7"
            m = re.match(r"^(\d{7})[~～](\d{7})$", period)
            if m:
                a, b = m.group(1), m.group(2)
                period = f"{a[:3]}/{int(a[3:5])}/{int(a[5:7])}～{b[:3]}/{int(b[3:5])}/{int(b[5:7])}"
            date_range = _parse_roc_range(period)
            if not date_range:
                continue
            out.append({
                "symbol": symbol,
                "name": name,
                "reason": str(row.get("DispositionReasons", "")).strip()[:60],
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
