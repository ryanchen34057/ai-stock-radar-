"""
Fetch three-institution (外資/投信/自營商) and margin trading (融資/融券) data
from TWSE and TPEx public APIs. No API key required.
"""
import requests
import urllib3
import logging
from datetime import datetime, timedelta

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json, text/plain, */*",
}


def _parse_int(s) -> int:
    try:
        return int(str(s).replace(",", "").replace("+", "").strip())
    except Exception:
        return 0


def _tw_date(date_str: str) -> str:
    """Convert YYYYMMDD → ROC year M/D format for TPEx (e.g. 20260418 → 115/04/18)."""
    y = int(date_str[:4]) - 1911
    return f"{y}/{date_str[4:6]}/{date_str[6:8]}"


def _last_weekday(date_str: str | None = None) -> str:
    """Return the most recent weekday as YYYYMMDD."""
    d = datetime.strptime(date_str, "%Y%m%d") if date_str else datetime.now()
    while d.weekday() >= 5:  # Sat=5, Sun=6
        d -= timedelta(days=1)
    return d.strftime("%Y%m%d")


# ── TWSE three-institution ────────────────────────────────────────────────────

def _fetch_twse_institutional(date: str) -> dict:
    """
    TWSE T86 response column layout (verified 2026-04):
      row[4]  外陸資買賣超(不含外資自營商)
      row[7]  外資自營商買賣超
      row[10] 投信買賣超
      row[11] 自營商買賣超合計
      row[18] 三大法人買賣超總計
    """
    url = "https://www.twse.com.tw/fund/T86"
    params = {"response": "json", "date": date, "selectType": "ALLBUT0999"}
    try:
        r = requests.get(url, params=params, headers=HEADERS, timeout=15, verify=False)
        data = r.json()
        if data.get("stat") != "OK":
            return {}
        result = {}
        skipped = 0
        for row in data.get("data", []):
            # Per-row try/except — one malformed row (shorter columns, non-
            # numeric, header residue) shouldn't kill the whole dict.
            try:
                sym = row[0].strip()
                if not sym:
                    continue
                # Combine 外陸資 + 外資自營商 as "外資"
                foreign = _parse_int(row[4]) + _parse_int(row[7])
                result[sym] = {
                    "foreign_net": foreign,
                    "trust_net":   _parse_int(row[10]),
                    "dealer_net":  _parse_int(row[11]),
                    # row[18] = 三大法人合計 (19-col schema). If TWSE temporarily
                    # truncates columns, fall back to computing the sum.
                    "total_net":   _parse_int(row[18]) if len(row) > 18
                                   else foreign + _parse_int(row[10]) + _parse_int(row[11]),
                }
            except (IndexError, ValueError, AttributeError) as row_err:
                skipped += 1
                if skipped <= 3:  # only log first few
                    logger.debug(f"TWSE T86 bad row ({date}): {row_err} row={row[:3] if row else []}")
        logger.info(f"TWSE institutional {date}: {len(result)} stocks ({skipped} rows skipped)")
        return result
    except Exception as e:
        logger.warning(f"TWSE institutional error ({date}): {e}")
        return {}


# ── TPEx three-institution ────────────────────────────────────────────────────

def _fetch_tpex_institutional(date: str) -> dict:
    """
    TPEx column layout (24 cols, verified 2026-04 via 3211 cross-sum check):
      row[4]  外資及陸資買賣超 (不含外資自營商)
      row[7]  外資自營商買賣超
      row[10] 外資及陸資合計買賣超 (含自營商)
      row[13] 投信買賣超
      row[16] 自營商(自行買賣)買賣超
      row[19] 自營商(避險)買賣超
      row[22] 自營商合計買賣超
      row[23] 三大法人買賣超合計 (= row[10]+row[13]+row[22])
    Response: json.tables[0].data  (old code incorrectly read aaData)
    """
    url = ("https://www.tpex.org.tw/web/stock/3insti/daily_trade/"
           "3itrade_hedge_result.php")
    params = {"l": "zh-tw", "t": "D", "d": _tw_date(date), "se": "EW", "s": "0,asc,0"}
    try:
        r = requests.get(
            url, params=params,
            headers={**HEADERS, "Referer": "https://www.tpex.org.tw"},
            timeout=15, verify=False,
        )
        data = r.json()
        # Response now uses tables[0].data instead of aaData
        rows = (data.get("tables", [{}])[0].get("data")
                if data.get("tables") else data.get("aaData", []))
        result = {}
        skipped = 0
        for row in rows or []:
            try:
                sym = str(row[0]).strip()
                if not sym:
                    continue
                result[sym] = {
                    "foreign_net": _parse_int(row[10]),
                    "trust_net":   _parse_int(row[13]),
                    "dealer_net":  _parse_int(row[22]),
                    "total_net":   _parse_int(row[23]),
                }
            except (IndexError, ValueError, AttributeError):
                skipped += 1
        logger.info(f"TPEx institutional {date}: {len(result)} stocks ({skipped} rows skipped)")
        return result
    except Exception as e:
        logger.warning(f"TPEx institutional error ({date}): {e}")
        return {}


# ── TWSE margin trading ───────────────────────────────────────────────────────

def _fetch_twse_margin(date: str) -> dict:
    url = "https://www.twse.com.tw/exchangeReport/MI_MARGN"
    params = {"response": "json", "date": date, "selectType": "ALL"}
    try:
        r = requests.get(url, params=params, headers=HEADERS, timeout=15, verify=False)
        data = r.json()
        if data.get("stat") != "OK":
            return {}
        # Per-stock data now lives in tables[1].data (old code read top-level 'data' which is empty)
        tables = data.get("tables", [])
        rows = tables[1].get("data", []) if len(tables) > 1 else data.get("data", [])
        result = {}
        for row in rows:
            sym = row[0].strip()
            prev_margin = _parse_int(row[5])
            curr_margin = _parse_int(row[6])
            prev_short  = _parse_int(row[11])
            curr_short  = _parse_int(row[12])
            result[sym] = {
                "margin_balance": curr_margin,
                "margin_change":  curr_margin - prev_margin,
                "short_balance":  curr_short,
                "short_change":   curr_short - prev_short,
            }
        logger.info(f"TWSE margin {date}: {len(result)} stocks")
        return result
    except Exception as e:
        logger.warning(f"TWSE margin error ({date}): {e}")
        return {}


# ── TPEx margin trading ───────────────────────────────────────────────────────

def _fetch_tpex_margin(date: str) -> dict:
    """
    TPEx margin column layout (verified 2026-04):
      row[2]  融資 前日餘額
      row[6]  融資 今日餘額
      row[10] 融券 前日餘額
      row[14] 融券 今日餘額
    """
    url = ("https://www.tpex.org.tw/web/stock/margin_trading/margin_balance/"
           "margin_bal_result.php")
    params = {"l": "zh-tw", "o": "json", "d": _tw_date(date)}
    try:
        r = requests.get(
            url, params=params,
            headers={**HEADERS, "Referer": "https://www.tpex.org.tw"},
            timeout=15, verify=False,
        )
        data = r.json()
        # TPEx now uses tables[0].data; old code read aaData (empty)
        rows = (data.get("tables", [{}])[0].get("data")
                if data.get("tables") else data.get("aaData", []))
        result = {}
        for row in rows or []:
            sym = str(row[0]).strip()
            prev_margin = _parse_int(row[2])
            curr_margin = _parse_int(row[6])
            prev_short  = _parse_int(row[10])
            curr_short  = _parse_int(row[14])
            result[sym] = {
                "margin_balance": curr_margin,
                "margin_change":  curr_margin - prev_margin,
                "short_balance":  curr_short,
                "short_change":   curr_short - prev_short,
            }
        logger.info(f"TPEx margin {date}: {len(result)} stocks")
        return result
    except Exception as e:
        logger.warning(f"TPEx margin error ({date}): {e}")
        return {}


# ── Public interface ──────────────────────────────────────────────────────────

def _recent_weekdays(n: int, end_date: str | None = None) -> list[str]:
    """Return the last N weekdays (YYYYMMDD), most recent first."""
    end = datetime.strptime(end_date, "%Y%m%d") if end_date else datetime.now()
    out = []
    d = end
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.strftime("%Y%m%d"))
        d -= timedelta(days=1)
    return out


def backfill_institutional_history(days: int = 20) -> dict:
    """
    Fetch the last N weekdays of TWSE + TPEx institutional + margin data and
    write each day's rows to institutional_cache. Skips days we already have
    complete rows for to avoid hammering TWSE.
    """
    from app.database import get_connection
    target_dates = _recent_weekdays(days)
    fetched_days = 0
    skipped_days = 0
    written_rows = 0

    for d in target_dates:
        conn = get_connection()
        try:
            row = conn.execute(
                "SELECT COUNT(*) AS n FROM institutional_cache WHERE date = ?", (d,)
            ).fetchone()
            n_existing = row["n"] if row else 0
        finally:
            conn.close()
        # Already cached — skip (TWSE numbers for past days don't change)
        if n_existing > 100:
            skipped_days += 1
            continue

        twse_i  = _fetch_twse_institutional(d)
        tpex_i  = _fetch_tpex_institutional(d)
        twse_m  = _fetch_twse_margin(d)
        tpex_m  = _fetch_tpex_margin(d)

        # Skip days with no TWSE data (weekend / holiday / pre-publication)
        if not twse_i and not tpex_i:
            continue
        fetched_days += 1

        insti  = {**twse_i, **tpex_i}
        margin = {**twse_m, **tpex_m}
        covered = set(insti) | set(margin)

        rows = []
        for sym in covered:
            d_insti  = insti.get(sym,  {"foreign_net": 0, "trust_net": 0,
                                        "dealer_net": 0, "total_net": 0})
            d_margin = margin.get(sym, {"margin_balance": 0, "margin_change": 0,
                                        "short_balance": 0, "short_change": 0})
            rows.append((sym, d,
                         d_insti["foreign_net"],  d_insti["trust_net"],
                         d_insti["dealer_net"],   d_insti["total_net"],
                         d_margin["margin_balance"], d_margin["margin_change"],
                         d_margin["short_balance"],  d_margin["short_change"]))

        conn = get_connection()
        try:
            conn.executemany(
                """INSERT OR REPLACE INTO institutional_cache
                   (symbol, date, foreign_net, trust_net, dealer_net, total_net,
                    margin_balance, margin_change, short_balance, short_change)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                rows,
            )
            conn.commit()
            written_rows += len(rows)
        finally:
            conn.close()

        # Be polite to TWSE/TPEx
        import time
        time.sleep(1.5)

    logger.info(f"institutional backfill: {fetched_days} days fetched, "
                f"{skipped_days} days already cached, {written_rows} rows written")
    return {
        "days_requested": days,
        "days_fetched": fetched_days,
        "days_skipped": skipped_days,
        "rows_written": written_rows,
    }


def get_history(symbol: str, days: int = 20) -> list[dict]:
    """Read per-day history for one symbol from institutional_cache."""
    from app.database import get_connection
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT date, foreign_net, trust_net, dealer_net, total_net,
                      margin_balance, margin_change, short_balance, short_change
               FROM institutional_cache
               WHERE symbol = ?
               ORDER BY date DESC
               LIMIT ?""",
            (symbol, days),
        ).fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]


def get_institutional_data(date: str | None = None) -> dict:
    """
    Return merged TWSE + TPEx institutional + margin data indexed by symbol.
    Falls back one weekday if today has no data yet (market still open).

    Returns:
        {
          "date": "20260418",
          "stocks": {
            "2330": {
              "foreign_net": 12345,   # 千股，正=買超
              "trust_net": 678,
              "dealer_net": 90,
              "total_net": 13113,
              "margin_balance": 45678,
              "margin_change": 1234,
              "short_balance": 3456,
              "short_change": -123,
            },
            ...
          }
        }
    """
    target = _last_weekday(date)

    twse_i  = _fetch_twse_institutional(target)
    tpex_i  = _fetch_tpex_institutional(target)
    twse_m  = _fetch_twse_margin(target)
    tpex_m  = _fetch_tpex_margin(target)

    # If TWSE returned nothing, market might still be open — try previous day
    if not twse_i:
        prev = _last_weekday((datetime.strptime(target, "%Y%m%d") - timedelta(days=1))
                             .strftime("%Y%m%d"))
        logger.info(f"No data for {target}, retrying {prev}")
        twse_i = _fetch_twse_institutional(prev)
        tpex_i = _fetch_tpex_institutional(prev)
        twse_m = _fetch_twse_margin(prev)
        tpex_m = _fetch_tpex_margin(prev)
        target = prev

    insti  = {**twse_i, **tpex_i}
    margin = {**twse_m, **tpex_m}

    merged = {}
    all_syms = set(insti) | set(margin)
    for sym in all_syms:
        merged[sym] = {
            **insti.get(sym, {"foreign_net": 0, "trust_net": 0,
                               "dealer_net": 0, "total_net": 0}),
            **margin.get(sym, {"margin_balance": 0, "margin_change": 0,
                                "short_balance": 0, "short_change": 0}),
        }

    return {
        "date": target,
        "stocks": merged,
        # Caller uses this to avoid overwriting cache with zero-filled defaults
        # (e.g. when TWSE T86 fails but margin endpoint succeeds)
        "insti_covered":  sorted(insti.keys()),
        "margin_covered": sorted(margin.keys()),
    }
