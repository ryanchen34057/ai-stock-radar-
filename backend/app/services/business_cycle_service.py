"""
準即時版景氣燈號 — 10 個指標加權總分，每日更新。

設計參考國發會 5 燈號框架，但換成對「AI/電子股」更有領先性的高頻指標組合：
  ✅ 每日: 加權指數 vs 200MA, 52 週高距, OTC 動能, SOX 年增, TSM ADR 溢價,
           10Y-2Y 殖利率, TWD 年變動
  📅 每月: 出口年增, 外銷訂單, PMI (先保留 stub, 後續可接 MOF/經濟部 API)

每項 1-5 分 → 加權總分 → 六級燈號（國發會 5 燈 + 極熱紅燈）:
  45-50 🔴 鮮紅燈 嚴重過熱    獲利了結
  38-44 🟠 紅燈   偏熱        停止加碼
  28-37 🟡 黃紅燈 溫和擴張    正常操作
  22-27 🟢 綠燈   穩定        SEPA/VCP 進場
  16-21 🔵 黃藍燈 轉弱        減碼
  10-15 🔷 藍燈   衰退        現金為王
"""
from __future__ import annotations
import json
import logging
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
import yfinance as yf
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
logger = logging.getLogger(__name__)


@dataclass
class Indicator:
    key: str
    name: str
    value: float | None         # 指標當前數值 (e.g. +12.5 代表 +12.5%)
    unit: str                   # "%" / "pts" / "bps"
    score: int | None           # 1-5 分, None = 無法計算
    weight: float               # 0-1 權重
    source: str                 # "TWSE", "yfinance", etc.
    note: str = ""              # 額外說明


# ── scoring helper ───────────────────────────────────────────────────────────

def _score_by_buckets(value: float | None, buckets: list[tuple[float, int]]) -> int | None:
    """
    Given ascending list of (threshold, score) tuples, return score for value.
    buckets[i] = (upper_bound_exclusive, score_if_below).
    Last bucket's threshold is ignored (catch-all).
    Example: [(-20, 1), (0, 2), (20, 3), (50, 4), (999, 5)]
             → value=-30 → 1, value=10 → 3, value=100 → 5
    """
    if value is None:
        return None
    for threshold, score in buckets:
        if value < threshold:
            return score
    return buckets[-1][1]


# ── yfinance fetchers ────────────────────────────────────────────────────────

def _yf_history(symbol: str, period: str = "2y") -> list[float] | None:
    """Return list of closing prices, most recent last."""
    try:
        t = yf.Ticker(symbol)
        h = t.history(period=period)
        if h.empty:
            return None
        return [float(x) for x in h["Close"].values]
    except Exception as e:
        logger.warning(f"yf {symbol}: {e}")
        return None


def _pct_change(closes: list[float], days_back: int) -> float | None:
    """Percentage change between last close and close `days_back` ago."""
    if len(closes) <= days_back:
        return None
    prev = closes[-1 - days_back]
    if prev == 0:
        return None
    return (closes[-1] - prev) / prev * 100.0


# ── Individual indicator computations ────────────────────────────────────────

def _ind_twii_vs_ma200() -> Indicator:
    closes = _yf_history("^TWII", "2y")
    if not closes or len(closes) < 200:
        return Indicator("twii_vs_ma200", "加權指數 vs 200MA", None, "%", None, 0.15, "yfinance",
                         "資料不足")
    ma200 = sum(closes[-200:]) / 200
    deviation = (closes[-1] - ma200) / ma200 * 100
    # +20%→5, +10%→4, 0%→3, -10%→2, <-10%→1
    score = _score_by_buckets(deviation, [(-10, 1), (0, 2), (10, 3), (20, 4), (999, 5)])
    return Indicator("twii_vs_ma200", "加權指數 vs 200MA", round(deviation, 2), "%",
                     score, 0.15, "yfinance", f"MA200={ma200:.0f}")


def _ind_twii_from_52w_high() -> Indicator:
    closes = _yf_history("^TWII", "1y")
    if not closes or len(closes) < 240:
        return Indicator("twii_from_52w_high", "加權指數 52 週高距", None, "%", None, 0.10, "yfinance",
                         "資料不足")
    high52 = max(closes[-240:])
    distance = (closes[-1] - high52) / high52 * 100  # always ≤ 0
    # At high(0%) = 5, -3%=4, -10%=3, -20%=2, <-20%=1
    score = _score_by_buckets(distance, [(-20, 1), (-10, 2), (-3, 3), (0, 4), (999, 5)])
    return Indicator("twii_from_52w_high", "52 週高距", round(distance, 2), "%",
                     score, 0.10, "yfinance", f"高={high52:.0f}")


def _ind_otc_momentum() -> Indicator:
    # 櫃買指數. yfinance 用 ^TWOII (未必所有時期都有)
    closes = _yf_history("^TWOII", "6mo")
    if not closes or len(closes) < 20:
        return Indicator("otc_momentum", "櫃買動能 (20d)", None, "%", None, 0.10, "yfinance",
                         "資料不足")
    change_20d = _pct_change(closes, 20)
    # +10%→5, +5%→4, 0%→3, -5%→2, <-5%→1
    score = _score_by_buckets(change_20d, [(-5, 1), (0, 2), (5, 3), (10, 4), (999, 5)])
    return Indicator("otc_momentum", "櫃買動能 (20d)", round(change_20d, 2), "%",
                     score, 0.10, "yfinance")


def _ind_sox_yoy() -> Indicator:
    # 費城半導體指數. ^SOX 在 yfinance 上的歷史有時不穩，用 SOXX ETF 當 fallback.
    closes = _yf_history("^SOX", "2y") or _yf_history("SOXX", "2y")
    if not closes or len(closes) < 252:
        return Indicator("sox_yoy", "費半年增率", None, "%", None, 0.15, "yfinance",
                         "資料不足")
    yoy = _pct_change(closes, 252)
    # +50%→5, +20%→4, 0%→3, -20%→2, <-20%→1
    score = _score_by_buckets(yoy, [(-20, 1), (0, 2), (20, 3), (50, 4), (999, 5)])
    return Indicator("sox_yoy", "費半年增率", round(yoy, 2), "%",
                     score, 0.15, "yfinance")


def _ind_tsm_adr_premium() -> Indicator:
    # TSM (美 ADR) vs 2330.TW 的溢價折價率. ADR 1 股 = 5 股普通股.
    try:
        tsm = yf.Ticker("TSM").history(period="5d")
        twse = yf.Ticker("2330.TW").history(period="5d")
        usd = yf.Ticker("TWD=X").history(period="5d")  # USD/TWD
        if tsm.empty or twse.empty or usd.empty:
            raise ValueError("empty data")
        tsm_usd = float(tsm["Close"].iloc[-1])
        twse_ntd = float(twse["Close"].iloc[-1])
        fx = float(usd["Close"].iloc[-1])
        # ADR 對應 5 股普通股，先換算回 NTD 每股
        adr_per_share_ntd = (tsm_usd / 5) * fx
        premium = (adr_per_share_ntd - twse_ntd) / twse_ntd * 100
    except Exception as e:
        logger.warning(f"tsm_adr: {e}")
        return Indicator("tsm_adr_premium", "TSM ADR 溢價", None, "%", None, 0.10, "yfinance",
                         "資料不足")
    # ADR 大幅溢價代表美國搶買 = 領先看多訊號. +20%→5, +10%→4, +5%→3, 0%→2, <0%→1
    score = _score_by_buckets(premium, [(0, 1), (5, 2), (10, 3), (20, 4), (999, 5)])
    return Indicator("tsm_adr_premium", "TSM ADR 溢價/折價", round(premium, 2), "%",
                     score, 0.10, "yfinance")


def _ind_yield_curve() -> Indicator:
    # ^TNX = 10Y, ^FVX = 5Y. 沒有 2Y 直接 symbol, 用 5Y 當 proxy.
    ten = _yf_history("^TNX", "5d")
    five = _yf_history("^FVX", "5d")
    if not ten or not five:
        return Indicator("yield_curve", "10Y-5Y 殖利率差 (proxy)", None, "bps", None, 0.10, "yfinance",
                         "資料不足")
    spread = ten[-1] - five[-1]  # 百分點 → 100 bps = 1%
    spread_bps = spread * 100
    # 正常向上斜率: +50bps→5, +20bps→4, +0→3, -20bps→2, <-20bps→1 (深度倒掛)
    score = _score_by_buckets(spread_bps, [(-20, 1), (0, 2), (20, 3), (50, 4), (999, 5)])
    return Indicator("yield_curve", "10Y-5Y 殖利率差", round(spread_bps, 1), "bps",
                     score, 0.10, "yfinance", f"10Y={ten[-1]:.2f}% 5Y={five[-1]:.2f}%")


def _ind_twd_yoy() -> Indicator:
    # USD/TWD 年變動. TWD 升值 = USD/TWD 下跌, 對出口不利.
    closes = _yf_history("TWD=X", "2y")
    if not closes or len(closes) < 252:
        return Indicator("twd_yoy", "TWD 年變動", None, "%", None, 0.05, "yfinance",
                         "資料不足")
    yoy = _pct_change(closes, 252)
    # 注意方向: USD/TWD +升 = TWD 貶 = 出口有利 (正分高)
    # +5%→5, +2%→4, 0%→3, -2%→2, <-2%→1
    score = _score_by_buckets(yoy, [(-2, 1), (0, 2), (2, 3), (5, 4), (999, 5)])
    return Indicator("twd_yoy", "TWD 貶值幅度 (y)", round(yoy, 2), "%",
                     score, 0.05, "yfinance", "USD/TWD 年變動, 正數=貶值")


# Monthly indicators — stubs. Return score=None so they're excluded from sum
# until we wire up MOF/經濟部 OpenAPI.
def _ind_export_yoy() -> Indicator:
    return Indicator("export_yoy", "海關出口年增率", None, "%", None, 0.10, "MOF OpenAPI",
                     "待接: 財政部 OpenAPI (每月 7 日公布)")


def _ind_export_orders_yoy() -> Indicator:
    return Indicator("export_orders_yoy", "外銷訂單年增率", None, "%", None, 0.10, "經濟部",
                     "待接: 經濟部統計處 (每月 20 日)")


def _ind_pmi() -> Indicator:
    return Indicator("pmi", "製造業 PMI", None, "pts", None, 0.05, "中經院",
                     "待接: 中經院 (每月 1 日)")


# ── aggregation ──────────────────────────────────────────────────────────────

_LIGHTS = [
    (45.0, "鮮紅燈", "extreme_hot",   "#B71C1C", "嚴重過熱", "積極獲利了結"),
    (38.0, "紅燈",   "hot",           "#FF3B3B", "偏熱",     "停止加碼, 收緊停損"),
    (28.0, "黃紅燈", "warm",          "#FF9800", "溫和擴張", "正常操作"),
    (22.0, "綠燈",   "neutral",       "#00C851", "穩定",     "SEPA/VCP 進場"),
    (16.0, "黃藍燈", "cool",          "#58A6FF", "轉弱",     "減碼, 只做強勢股"),
    (0.0,  "藍燈",   "cold",          "#1976D2", "衰退",     "現金為王, 少量試單"),
]


def _classify(score: float) -> dict:
    for threshold, label, key, color, state, action in _LIGHTS:
        if score >= threshold:
            return {"label": label, "key": key, "color": color, "state": state, "action": action}
    return {"label": "藍燈", "key": "cold", "color": "#1976D2", "state": "衰退", "action": "現金為王"}


def compute_business_cycle() -> dict:
    """
    Run all indicators, compute weighted total score, return full result.
    Score scale: sum(weight * score) normalised to a 10-50 scale so the
    classification thresholds stay stable even when some indicators fail.
    """
    indicators = [
        _ind_twii_vs_ma200(),
        _ind_twii_from_52w_high(),
        _ind_otc_momentum(),
        _ind_sox_yoy(),
        _ind_tsm_adr_premium(),
        _ind_yield_curve(),
        _ind_twd_yoy(),
        _ind_export_yoy(),
        _ind_export_orders_yoy(),
        _ind_pmi(),
    ]

    # Only count indicators with a score
    scored = [i for i in indicators if i.score is not None]
    if not scored:
        return {"error": "no_indicators_available", "indicators": [asdict(i) for i in indicators]}

    # Weighted average (on 1-5 scale), then rescale to 10-50
    total_weight = sum(i.weight for i in scored)
    weighted_avg = sum(i.score * i.weight for i in scored) / total_weight
    total_score = weighted_avg * 10  # 1→10, 5→50

    light = _classify(total_score)

    return {
        "as_of": datetime.now(timezone.utc).isoformat(),
        "total_score": round(total_score, 1),
        "weighted_avg": round(weighted_avg, 2),
        "indicators_used": len(scored),
        "indicators_total": len(indicators),
        **light,
        "indicators": [asdict(i) for i in indicators],
    }


# ── DB cache ─────────────────────────────────────────────────────────────────

def save_snapshot(conn, snapshot: dict):
    """Write today's snapshot to DB cache. Keys by date (YYYY-MM-DD)."""
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
    """Return list of {date, total_score, key} for the sparkline strip."""
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
    """Fetch fresh data, save, return snapshot."""
    snap = compute_business_cycle()
    try:
        save_snapshot(conn, snap)
    except Exception as e:
        logger.error(f"save business_cycle snapshot: {e}")
    return snap
