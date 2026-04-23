"""
準即時版景氣燈號 — 10 個指標加權總分，每日更新。

設計參考國發會 5 燈號框架，但換成對「AI/電子股」更有領先性的高頻指標組合：
  ✅ 每日: 加權指數 vs 200MA, 52 週高距, OTC 動能, SOX 年增, TSM ADR 溢價,
           10Y-5Y 殖利率, TWD 年變動
  📅 每月: 海關出口 / 外銷訂單 (FinMind), PMI (手動輸入或抓取)

每項 1-5 分 → 加權總分 → 六級燈號（國發會 5 燈 + 極熱紅燈）:
  45-50 🔴 鮮紅燈 嚴重過熱    獲利了結
  38-44 🟠 紅燈   偏熱        停止加碼
  28-37 🟡 黃紅燈 溫和擴張    正常操作
  22-27 🟢 綠燈   穩定        SEPA/VCP 進場
  16-21 🔵 黃藍燈 轉弱        減碼
  10-15 🔷 藍燈   衰退        現金為王

評分模式:
  - 若 DB 有歷史分位數 (business_cycle_percentiles table): 用 P20/40/60/80 切點
  - 否則 fallback 到硬編碼絕對閾值
  分位數由 refresh_percentiles() 週期性計算 (10 年歷史, 每週一次就夠)。
"""
from __future__ import annotations
import json
import logging
import statistics
from dataclasses import dataclass, asdict
from datetime import datetime, timezone, timedelta
from typing import Callable
import yfinance as yf
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
logger = logging.getLogger(__name__)


@dataclass
class Indicator:
    key: str
    name: str
    value: float | None
    unit: str
    score: int | None
    weight: float
    source: str
    note: str = ""
    scoring: str = "absolute"       # "absolute" | "percentile"


@dataclass
class Percentiles:
    p20: float
    p40: float
    p60: float
    p80: float
    direction: str = "higher_is_better"   # or "lower_is_better"


# ── scoring helpers ──────────────────────────────────────────────────────────

def _score_absolute(value: float | None, buckets: list[tuple[float, int]]) -> int | None:
    """Hard-coded threshold buckets — fallback when no percentile data."""
    if value is None:
        return None
    for threshold, score in buckets:
        if value < threshold:
            return score
    return buckets[-1][1]


def _score_percentile(value: float | None, p: Percentiles) -> int | None:
    """Percentile-based score 1-5, direction-aware."""
    if value is None:
        return None
    if p.direction == "higher_is_better":
        if value < p.p20: return 1
        if value < p.p40: return 2
        if value < p.p60: return 3
        if value < p.p80: return 4
        return 5
    else:  # lower_is_better (unused for now, kept for symmetry)
        if value > p.p80: return 1
        if value > p.p60: return 2
        if value > p.p40: return 3
        if value > p.p20: return 4
        return 5


def _load_percentiles(conn) -> dict[str, Percentiles]:
    try:
        rows = conn.execute(
            "SELECT indicator_key, p20, p40, p60, p80, direction FROM business_cycle_percentiles"
        ).fetchall()
    except Exception:
        return {}
    out = {}
    for r in rows:
        out[r["indicator_key"]] = Percentiles(r["p20"], r["p40"], r["p60"], r["p80"],
                                              r["direction"] or "higher_is_better")
    return out


# ── yfinance helpers ─────────────────────────────────────────────────────────

def _yf_history(symbol: str, period: str = "2y") -> list[float] | None:
    try:
        t = yf.Ticker(symbol)
        h = t.history(period=period)
        if h.empty:
            return None
        return [float(x) for x in h["Close"].values]
    except Exception as e:
        logger.warning(f"yf {symbol}: {e}")
        return None


def _yf_history_pd(symbol: str, period: str = "10y"):
    """Return pandas Series of closes or None (for historical-series computations)."""
    try:
        t = yf.Ticker(symbol)
        h = t.history(period=period)
        if h.empty:
            return None
        return h["Close"]
    except Exception as e:
        logger.warning(f"yf {symbol}: {e}")
        return None


def _pct_change(closes: list[float], days_back: int) -> float | None:
    if len(closes) <= days_back:
        return None
    prev = closes[-1 - days_back]
    if prev == 0:
        return None
    return (closes[-1] - prev) / prev * 100.0


# ── FinMind helpers (monthly macro) ──────────────────────────────────────────

def _finmind_macro_fetch(dataset: str, start_date: str) -> list[dict]:
    """
    National-level macro datasets don't take data_id -- passing an empty one
    triggers 422. Own fetcher that omits it entirely.
    """
    import os, requests
    BASE_URL = "https://api.finmindtrade.com/api/v4/data"
    params = {"dataset": dataset, "start_date": start_date}
    headers = {}
    tok = os.environ.get("FINMIND_TOKEN", "").strip()
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
    try:
        r = requests.get(BASE_URL, params=params, headers=headers, timeout=15)
        if r.status_code == 402:
            logger.warning(f"FinMind {dataset}: quota exhausted")
            return []
        r.raise_for_status()
        j = r.json()
        if j.get("msg") != "success":
            logger.warning(f"FinMind {dataset}: {j.get('msg')}")
            return []
        return j.get("data", []) or []
    except Exception as e:
        logger.warning(f"FinMind {dataset} error: {e}")
        return []


def _finmind_monthly_yoy(dataset: str, value_key: str, start_years_back: int = 3) -> tuple[float | None, str | None]:
    """
    Pull a FinMind monthly dataset and compute YoY of the most recent month.
    Returns (yoy_percent, latest_month_label) or (None, None).
    """
    start = (datetime.now() - timedelta(days=start_years_back * 365 + 60)).strftime("%Y-%m-%d")
    data = _finmind_macro_fetch(dataset, start)
    if not data:
        return None, None

    # Each entry typically has "date" (YYYY-MM-01) and the value key.
    # Build {(yyyy, mm): value}
    monthly: dict[tuple[int, int], float] = {}
    for row in data:
        try:
            d = row.get("date", "")
            val = row.get(value_key)
            if val is None:
                continue
            parts = d.split("-")
            if len(parts) < 2:
                continue
            y, m = int(parts[0]), int(parts[1])
            monthly[(y, m)] = float(val)
        except Exception:
            continue

    if not monthly:
        return None, None

    latest_ym = max(monthly.keys())
    prev_ym = (latest_ym[0] - 1, latest_ym[1])
    if prev_ym not in monthly:
        return None, None

    cur = monthly[latest_ym]
    prev = monthly[prev_ym]
    if prev == 0:
        return None, None
    yoy = (cur - prev) / prev * 100.0
    return yoy, f"{latest_ym[0]}-{latest_ym[1]:02d}"


# ── Indicator computations ───────────────────────────────────────────────────

def _ind_twii_vs_ma200(pcts: dict[str, Percentiles]) -> Indicator:
    closes = _yf_history("^TWII", "2y")
    if not closes or len(closes) < 200:
        return Indicator("twii_vs_ma200", "加權指數 vs 200MA", None, "%", None, 0.15, "yfinance", "資料不足")
    ma200 = sum(closes[-200:]) / 200
    dev = (closes[-1] - ma200) / ma200 * 100
    p = pcts.get("twii_vs_ma200")
    if p:
        score = _score_percentile(dev, p)
        mode = "percentile"
    else:
        score = _score_absolute(dev, [(-10, 1), (0, 2), (10, 3), (20, 4), (999, 5)])
        mode = "absolute"
    return Indicator("twii_vs_ma200", "加權指數 vs 200MA", round(dev, 2), "%",
                     score, 0.15, "yfinance", f"MA200={ma200:.0f}", mode)


def _ind_twii_from_52w_high(pcts: dict[str, Percentiles]) -> Indicator:
    closes = _yf_history("^TWII", "1y")
    if not closes or len(closes) < 240:
        return Indicator("twii_from_52w_high", "52 週高距", None, "%", None, 0.10, "yfinance", "資料不足")
    high52 = max(closes[-240:])
    dist = (closes[-1] - high52) / high52 * 100
    p = pcts.get("twii_from_52w_high")
    if p:
        score = _score_percentile(dist, p)
        mode = "percentile"
    else:
        score = _score_absolute(dist, [(-20, 1), (-10, 2), (-3, 3), (0, 4), (999, 5)])
        mode = "absolute"
    return Indicator("twii_from_52w_high", "52 週高距", round(dist, 2), "%",
                     score, 0.10, "yfinance", f"高={high52:.0f}", mode)


def _ind_otc_momentum(pcts: dict[str, Percentiles]) -> Indicator:
    closes = _yf_history("^TWOII", "6mo")
    if not closes or len(closes) < 20:
        return Indicator("otc_momentum", "櫃買動能 (20d)", None, "%", None, 0.10, "yfinance", "資料不足")
    chg = _pct_change(closes, 20)
    p = pcts.get("otc_momentum")
    if p:
        score = _score_percentile(chg, p)
        mode = "percentile"
    else:
        score = _score_absolute(chg, [(-5, 1), (0, 2), (5, 3), (10, 4), (999, 5)])
        mode = "absolute"
    return Indicator("otc_momentum", "櫃買動能 (20d)", round(chg, 2) if chg is not None else None, "%",
                     score, 0.10, "yfinance", "", mode)


def _ind_sox_yoy(pcts: dict[str, Percentiles]) -> Indicator:
    closes = _yf_history("^SOX", "2y") or _yf_history("SOXX", "2y")
    if not closes or len(closes) < 252:
        return Indicator("sox_yoy", "費半年增率", None, "%", None, 0.15, "yfinance", "資料不足")
    yoy = _pct_change(closes, 252)
    p = pcts.get("sox_yoy")
    if p:
        score = _score_percentile(yoy, p)
        mode = "percentile"
    else:
        score = _score_absolute(yoy, [(-20, 1), (0, 2), (20, 3), (50, 4), (999, 5)])
        mode = "absolute"
    return Indicator("sox_yoy", "費半年增率", round(yoy, 2) if yoy is not None else None, "%",
                     score, 0.15, "yfinance", "", mode)


def _ind_tsm_adr_premium(pcts: dict[str, Percentiles]) -> Indicator:
    try:
        tsm = yf.Ticker("TSM").history(period="5d")
        twse = yf.Ticker("2330.TW").history(period="5d")
        usd = yf.Ticker("TWD=X").history(period="5d")
        if tsm.empty or twse.empty or usd.empty:
            raise ValueError("empty")
        tsm_usd = float(tsm["Close"].iloc[-1])
        twse_ntd = float(twse["Close"].iloc[-1])
        fx = float(usd["Close"].iloc[-1])
        adr_ntd = (tsm_usd / 5) * fx
        prem = (adr_ntd - twse_ntd) / twse_ntd * 100
    except Exception as e:
        logger.warning(f"tsm_adr: {e}")
        return Indicator("tsm_adr_premium", "TSM ADR 溢價", None, "%", None, 0.10, "yfinance", "資料不足")
    p = pcts.get("tsm_adr_premium")
    if p:
        score = _score_percentile(prem, p)
        mode = "percentile"
    else:
        score = _score_absolute(prem, [(0, 1), (5, 2), (10, 3), (20, 4), (999, 5)])
        mode = "absolute"
    return Indicator("tsm_adr_premium", "TSM ADR 溢價/折價", round(prem, 2), "%",
                     score, 0.10, "yfinance", "", mode)


def _ind_yield_curve(pcts: dict[str, Percentiles]) -> Indicator:
    ten = _yf_history("^TNX", "5d")
    five = _yf_history("^FVX", "5d")
    if not ten or not five:
        return Indicator("yield_curve", "10Y-5Y 殖利率差", None, "bps", None, 0.10, "yfinance", "資料不足")
    spread_bps = (ten[-1] - five[-1]) * 100
    p = pcts.get("yield_curve")
    if p:
        score = _score_percentile(spread_bps, p)
        mode = "percentile"
    else:
        score = _score_absolute(spread_bps, [(-20, 1), (0, 2), (20, 3), (50, 4), (999, 5)])
        mode = "absolute"
    return Indicator("yield_curve", "10Y-5Y 殖利率差", round(spread_bps, 1), "bps",
                     score, 0.10, "yfinance", f"10Y={ten[-1]:.2f}% 5Y={five[-1]:.2f}%", mode)


def _ind_twd_yoy(pcts: dict[str, Percentiles]) -> Indicator:
    closes = _yf_history("TWD=X", "2y")
    if not closes or len(closes) < 252:
        return Indicator("twd_yoy", "TWD 貶值幅度 (y)", None, "%", None, 0.05, "yfinance", "資料不足")
    yoy = _pct_change(closes, 252)
    p = pcts.get("twd_yoy")
    if p:
        score = _score_percentile(yoy, p)
        mode = "percentile"
    else:
        score = _score_absolute(yoy, [(-2, 1), (0, 2), (2, 3), (5, 4), (999, 5)])
        mode = "absolute"
    return Indicator("twd_yoy", "TWD 貶值幅度 (y)", round(yoy, 2) if yoy is not None else None, "%",
                     score, 0.05, "yfinance", "USD/TWD 年變動, 正=貶值", mode)


# ── Monthly indicators (FinMind) ─────────────────────────────────────────────

def _ind_export_yoy(pcts: dict[str, Percentiles]) -> Indicator:
    yoy, label = _finmind_monthly_yoy("TaiwanExportImportTradeValue", "export")
    if yoy is None:
        return Indicator("export_yoy", "海關出口年增率", None, "%", None, 0.10,
                         "FinMind", "資料暫缺或 FinMind quota 已用盡")
    p = pcts.get("export_yoy")
    if p:
        score = _score_percentile(yoy, p)
        mode = "percentile"
    else:
        # 台灣出口 YoY: >+20%=過熱, +10~20=強, 0~10=穩, -10~0=弱, <-10=衰退
        score = _score_absolute(yoy, [(-10, 1), (0, 2), (10, 3), (20, 4), (999, 5)])
        mode = "absolute"
    return Indicator("export_yoy", "海關出口年增率", round(yoy, 2), "%",
                     score, 0.10, "FinMind", f"最新月份: {label}", mode)


def _ind_export_orders_yoy(pcts: dict[str, Percentiles]) -> Indicator:
    # FinMind 外銷訂單 dataset key
    yoy, label = _finmind_monthly_yoy("TaiwanExportOrder", "amount")
    if yoy is None:
        return Indicator("export_orders_yoy", "外銷訂單年增率", None, "%", None, 0.10,
                         "FinMind", "資料暫缺")
    p = pcts.get("export_orders_yoy")
    if p:
        score = _score_percentile(yoy, p)
        mode = "percentile"
    else:
        score = _score_absolute(yoy, [(-10, 1), (0, 2), (10, 3), (20, 4), (999, 5)])
        mode = "absolute"
    return Indicator("export_orders_yoy", "外銷訂單年增率", round(yoy, 2), "%",
                     score, 0.10, "FinMind", f"最新月份: {label}", mode)


def _ind_pmi(conn) -> Indicator:
    """
    PMI — read from app_settings.business_cycle_pmi (manually set by user
    because 中經院 doesn't offer a clean API). Format: "55.2|2026-04".
    """
    try:
        row = conn.execute(
            "SELECT value FROM app_settings WHERE key='business_cycle_pmi'"
        ).fetchone()
    except Exception:
        row = None
    if not row or not row["value"]:
        return Indicator("pmi", "製造業 PMI", None, "pts", None, 0.05, "manual",
                         "請至 /api/business-cycle/pmi 手動設定 (中經院每月 1 日發布)")

    raw = row["value"]
    try:
        parts = raw.split("|")
        val = float(parts[0])
        month = parts[1] if len(parts) > 1 else ""
    except Exception:
        return Indicator("pmi", "製造業 PMI", None, "pts", None, 0.05, "manual",
                         f"value 格式錯誤: {raw!r}")

    # PMI absolute thresholds (well-known): 55+=expansion, 50=neutral, <45=recession
    score = _score_absolute(val, [(45, 1), (48, 2), (50, 3), (55, 4), (999, 5)])
    return Indicator("pmi", "製造業 PMI", round(val, 1), "pts",
                     score, 0.05, "中經院 (手動)", f"最新月份: {month}", "absolute")


# ── Aggregation + classification ─────────────────────────────────────────────

_LIGHTS = [
    (45.0, "鮮紅燈", "extreme_hot", "#B71C1C", "嚴重過熱", "積極獲利了結"),
    (38.0, "紅燈",   "hot",         "#FF3B3B", "偏熱",     "停止加碼, 收緊停損"),
    (28.0, "黃紅燈", "warm",        "#FF9800", "溫和擴張", "正常操作"),
    (22.0, "綠燈",   "neutral",     "#00C851", "穩定",     "SEPA/VCP 進場"),
    (16.0, "黃藍燈", "cool",        "#58A6FF", "轉弱",     "減碼, 只做強勢股"),
    (0.0,  "藍燈",   "cold",        "#1976D2", "衰退",     "現金為王, 少量試單"),
]


def _classify(score: float) -> dict:
    for threshold, label, key, color, state, action in _LIGHTS:
        if score >= threshold:
            return {"label": label, "key": key, "color": color, "state": state, "action": action}
    return {"label": "藍燈", "key": "cold", "color": "#1976D2", "state": "衰退", "action": "現金為王"}


def compute_business_cycle(conn=None) -> dict:
    """Run all indicators, compute weighted total. Pass conn for DB-backed indicators (PMI)."""
    from app.database import get_connection
    own_conn = conn is None
    if own_conn:
        conn = get_connection()

    try:
        pcts = _load_percentiles(conn)

        indicators = [
            _ind_twii_vs_ma200(pcts),
            _ind_twii_from_52w_high(pcts),
            _ind_otc_momentum(pcts),
            _ind_sox_yoy(pcts),
            _ind_tsm_adr_premium(pcts),
            _ind_yield_curve(pcts),
            _ind_twd_yoy(pcts),
            _ind_export_yoy(pcts),
            _ind_export_orders_yoy(pcts),
            _ind_pmi(conn),
        ]
    finally:
        if own_conn:
            conn.close()

    scored = [i for i in indicators if i.score is not None]
    if not scored:
        return {"error": "no_indicators_available", "indicators": [asdict(i) for i in indicators]}

    total_weight = sum(i.weight for i in scored)
    weighted_avg = sum(i.score * i.weight for i in scored) / total_weight
    total_score = weighted_avg * 10

    light = _classify(total_score)
    return {
        "as_of": datetime.now(timezone.utc).isoformat(),
        "total_score": round(total_score, 1),
        "weighted_avg": round(weighted_avg, 2),
        "indicators_used": len(scored),
        "indicators_total": len(indicators),
        "has_percentile_calibration": bool(pcts),
        **light,
        "indicators": [asdict(i) for i in indicators],
    }


# ── Historical percentile calibration ────────────────────────────────────────
#
# For each indicator, generate a 10-year series of that indicator's value
# (computed same way as current) and store P20/P40/P60/P80 in DB.
#
# Run weekly — percentile thresholds change slowly enough.

def _series_twii_vs_ma200(years: int = 10) -> list[float]:
    """Daily series of TWII % deviation from its own 200MA over past N years."""
    s = _yf_history_pd("^TWII", f"{years}y")
    if s is None or len(s) < 210:
        return []
    import pandas as pd
    ma200 = s.rolling(200).mean()
    dev = ((s - ma200) / ma200 * 100).dropna()
    return [float(x) for x in dev.values]


def _series_twii_from_52w_high(years: int = 10) -> list[float]:
    s = _yf_history_pd("^TWII", f"{years}y")
    if s is None or len(s) < 250:
        return []
    import pandas as pd
    roll_max = s.rolling(240).max()
    dist = ((s - roll_max) / roll_max * 100).dropna()
    return [float(x) for x in dist.values]


def _series_otc_momentum(years: int = 5) -> list[float]:
    s = _yf_history_pd("^TWOII", f"{years}y")
    if s is None or len(s) < 30:
        return []
    pct = (s.pct_change(20) * 100).dropna()
    return [float(x) for x in pct.values]


def _series_sox_yoy(years: int = 10) -> list[float]:
    s = _yf_history_pd("^SOX", f"{years}y")
    if s is None or len(s) < 260:
        s = _yf_history_pd("SOXX", f"{years}y")
    if s is None or len(s) < 260:
        return []
    pct = (s.pct_change(252) * 100).dropna()
    return [float(x) for x in pct.values]


def _series_yield_curve(years: int = 10) -> list[float]:
    ten = _yf_history_pd("^TNX", f"{years}y")
    five = _yf_history_pd("^FVX", f"{years}y")
    if ten is None or five is None:
        return []
    import pandas as pd
    combined = pd.DataFrame({"ten": ten, "five": five}).dropna()
    spread_bps = (combined["ten"] - combined["five"]) * 100
    return [float(x) for x in spread_bps.values]


def _series_twd_yoy(years: int = 10) -> list[float]:
    s = _yf_history_pd("TWD=X", f"{years}y")
    if s is None or len(s) < 260:
        return []
    pct = (s.pct_change(252) * 100).dropna()
    return [float(x) for x in pct.values]


# ADR premium series requires intersecting TSM + 2330.TW + TWD=X — skip for
# simplicity, fall back to absolute scoring for that one indicator.

# Monthly: FinMind history is shorter, we pull all and compute YoY series.
def _series_monthly_yoy(dataset: str, value_key: str, years: int = 10) -> list[float]:
    start = (datetime.now() - timedelta(days=years * 365)).strftime("%Y-%m-%d")
    data = _finmind_macro_fetch(dataset, start)
    if not data:
        return []
    monthly: dict[tuple[int, int], float] = {}
    for row in data:
        try:
            d = row.get("date", "")
            val = row.get(value_key)
            if val is None:
                continue
            parts = d.split("-")
            y, m = int(parts[0]), int(parts[1])
            monthly[(y, m)] = float(val)
        except Exception:
            continue
    yoys = []
    for (y, m), v in sorted(monthly.items()):
        if (y - 1, m) in monthly and monthly[(y - 1, m)]:
            yoys.append((v - monthly[(y - 1, m)]) / monthly[(y - 1, m)] * 100)
    return yoys


def _series_export_yoy(years: int = 10) -> list[float]:
    return _series_monthly_yoy("TaiwanExportImportTradeValue", "export", years)


def _series_export_orders_yoy(years: int = 10) -> list[float]:
    return _series_monthly_yoy("TaiwanExportOrder", "amount", years)


_SERIES_BUILDERS: dict[str, Callable[[], list[float]]] = {
    "twii_vs_ma200":       _series_twii_vs_ma200,
    "twii_from_52w_high":  _series_twii_from_52w_high,
    "otc_momentum":        _series_otc_momentum,
    "sox_yoy":             _series_sox_yoy,
    "yield_curve":         _series_yield_curve,
    "twd_yoy":             _series_twd_yoy,
    "export_yoy":          _series_export_yoy,
    "export_orders_yoy":   _series_export_orders_yoy,
}


def _percentiles_of(series: list[float]) -> Percentiles | None:
    if len(series) < 30:
        return None
    s = sorted(series)

    def q(frac: float) -> float:
        idx = frac * (len(s) - 1)
        lo = int(idx)
        hi = min(lo + 1, len(s) - 1)
        w = idx - lo
        return s[lo] * (1 - w) + s[hi] * w

    return Percentiles(q(0.20), q(0.40), q(0.60), q(0.80))


def refresh_percentiles() -> dict:
    """
    Recompute historical percentiles for every indicator we can build a series
    for. Run weekly. Writes to business_cycle_percentiles table.
    """
    from app.database import get_connection
    conn = get_connection()
    try:
        results: dict[str, dict] = {}
        for key, builder in _SERIES_BUILDERS.items():
            try:
                series = builder()
            except Exception as e:
                logger.warning(f"series {key}: {e}")
                series = []
            p = _percentiles_of(series)
            if p is None:
                results[key] = {"status": "skipped", "samples": len(series)}
                continue
            conn.execute(
                """INSERT OR REPLACE INTO business_cycle_percentiles
                   (indicator_key, p20, p40, p60, p80, direction, sample_count, computed_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (key, p.p20, p.p40, p.p60, p.p80, "higher_is_better",
                 len(series), datetime.now(timezone.utc).isoformat()),
            )
            results[key] = {
                "status": "ok", "samples": len(series),
                "p20": round(p.p20, 2), "p40": round(p.p40, 2),
                "p60": round(p.p60, 2), "p80": round(p.p80, 2),
            }
        conn.commit()
        logger.info(f"percentiles refreshed: {results}")
        return {"status": "ok", "indicators": results}
    finally:
        conn.close()


# ── PMI manual override ──────────────────────────────────────────────────────

def set_pmi(value: float, month: str) -> None:
    """Store latest PMI reading. month format: 'YYYY-MM'."""
    from app.database import get_connection
    conn = get_connection()
    try:
        conn.execute(
            """INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)""",
            ("business_cycle_pmi", f"{value}|{month}"),
        )
        conn.commit()
    finally:
        conn.close()


def get_pmi() -> dict | None:
    from app.database import get_connection
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT value FROM app_settings WHERE key='business_cycle_pmi'"
        ).fetchone()
    finally:
        conn.close()
    if not row or not row["value"]:
        return None
    try:
        parts = row["value"].split("|")
        return {"value": float(parts[0]), "month": parts[1] if len(parts) > 1 else ""}
    except Exception:
        return None


# ── DB cache (daily snapshot) ────────────────────────────────────────────────

def save_snapshot(conn, snapshot: dict):
    date = datetime.now().strftime("%Y-%m-%d")
    conn.execute(
        """INSERT OR REPLACE INTO business_cycle_cache (date, data_json, fetched_at)
           VALUES (?, ?, ?)""",
        (date, json.dumps(snapshot, ensure_ascii=False),
         datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()


def load_latest(conn) -> dict | None:
    row = conn.execute(
        "SELECT data_json FROM business_cycle_cache ORDER BY date DESC LIMIT 1"
    ).fetchone()
    if not row:
        return None
    try:
        return json.loads(row["data_json"])
    except Exception:
        return None


def load_history(conn, days: int = 60) -> list[dict]:
    rows = conn.execute(
        "SELECT date, data_json FROM business_cycle_cache ORDER BY date DESC LIMIT ?",
        (days,),
    ).fetchall()
    out = []
    for r in rows:
        try:
            d = json.loads(r["data_json"])
            out.append({"date": r["date"], "total_score": d.get("total_score"),
                        "key": d.get("key")})
        except Exception:
            pass
    return list(reversed(out))


def refresh_business_cycle(conn) -> dict:
    snap = compute_business_cycle(conn)
    try:
        save_snapshot(conn, snap)
    except Exception as e:
        logger.error(f"save business_cycle snapshot: {e}")
    return snap
