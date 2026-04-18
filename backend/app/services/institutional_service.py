"""
Fetch three-institution (外資/投信/自營商) and margin trading (融資/融券) data
from TWSE and TPEx public APIs. No API key required.
"""
import requests
import logging
from datetime import datetime, timedelta

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
    url = "https://www.twse.com.tw/fund/T86"
    params = {"response": "json", "date": date, "selectType": "ALLBUT0999"}
    try:
        r = requests.get(url, params=params, headers=HEADERS, timeout=15)
        data = r.json()
        if data.get("stat") != "OK":
            return {}
        result = {}
        for row in data.get("data", []):
            sym = row[0].strip()
            result[sym] = {
                "foreign_net": _parse_int(row[4]),   # 外資買賣超
                "trust_net":   _parse_int(row[7]),   # 投信買賣超
                "dealer_net":  _parse_int(row[10]),  # 自營商買賣超
                "total_net":   _parse_int(row[11]),  # 三大法人合計
            }
        logger.info(f"TWSE institutional {date}: {len(result)} stocks")
        return result
    except Exception as e:
        logger.warning(f"TWSE institutional error ({date}): {e}")
        return {}


# ── TPEx three-institution ────────────────────────────────────────────────────

def _fetch_tpex_institutional(date: str) -> dict:
    url = ("https://www.tpex.org.tw/web/stock/3insti/daily_trade/"
           "3itrade_hedge_result.php")
    params = {"l": "zh-tw", "t": "D", "d": _tw_date(date), "se": "EW", "s": "0,asc,0"}
    try:
        r = requests.get(
            url, params=params,
            headers={**HEADERS, "Referer": "https://www.tpex.org.tw"},
            timeout=15,
        )
        data = r.json()
        result = {}
        for row in data.get("aaData", []):
            sym = str(row[0]).strip()
            result[sym] = {
                "foreign_net": _parse_int(row[4]),
                "trust_net":   _parse_int(row[7]),
                "dealer_net":  _parse_int(row[10]),
                "total_net":   _parse_int(row[11]),
            }
        logger.info(f"TPEx institutional {date}: {len(result)} stocks")
        return result
    except Exception as e:
        logger.warning(f"TPEx institutional error ({date}): {e}")
        return {}


# ── TWSE margin trading ───────────────────────────────────────────────────────

def _fetch_twse_margin(date: str) -> dict:
    url = "https://www.twse.com.tw/exchangeReport/MI_MARGN"
    params = {"response": "json", "date": date, "selectType": "ALL"}
    try:
        r = requests.get(url, params=params, headers=HEADERS, timeout=15)
        data = r.json()
        if data.get("stat") != "OK":
            return {}
        result = {}
        for row in data.get("data", []):
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
    url = ("https://www.tpex.org.tw/web/stock/margin_trading/margin_balance/"
           "margin_bal_result.php")
    params = {"l": "zh-tw", "o": "json", "d": _tw_date(date)}
    try:
        r = requests.get(
            url, params=params,
            headers={**HEADERS, "Referer": "https://www.tpex.org.tw"},
            timeout=15,
        )
        data = r.json()
        result = {}
        for row in data.get("aaData", []):
            sym = str(row[0]).strip()
            prev_margin = _parse_int(row[4])
            curr_margin = _parse_int(row[7])
            prev_short  = _parse_int(row[13])
            curr_short  = _parse_int(row[16])
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

    return {"date": target, "stocks": merged}
