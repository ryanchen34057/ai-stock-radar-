"""
FinMind service — fetches TW-stock fundamentals from FinMind API:
 - Quarterly financial statements (EPS, net income, revenue)
 - Monthly revenue (for YoY calculation)
 - Dividend history (for trailing-12m yield)

Anonymous access works with modest rate limits (~300 req/hr/IP). Register at
https://finmindtrade.com/analysis/#/data/api for a token and higher quota.
Token is read from the FINMIND_TOKEN env var or app_settings table.
"""
import logging
import os
import random
import time
from datetime import datetime, timedelta

import requests

from app.database import get_connection

logger = logging.getLogger(__name__)

BASE_URL = "https://api.finmindtrade.com/api/v4/data"
DEFAULT_TIMEOUT = 15
# Polite delay between requests so we don't get throttled
SLEEP_RANGE = (0.4, 0.9)


def _token() -> str:
    """Read token from env (set via Settings → app_settings → env at startup)."""
    return os.environ.get("FINMIND_TOKEN", "").strip()


def _fetch(dataset: str, data_id: str, start_date: str) -> list[dict]:
    """Generic FinMind v4 GET with optional auth."""
    params = {"dataset": dataset, "data_id": data_id, "start_date": start_date}
    headers = {}
    tok = _token()
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
    try:
        r = requests.get(BASE_URL, params=params, headers=headers, timeout=DEFAULT_TIMEOUT)
        if r.status_code == 402:
            logger.warning(f"FinMind {dataset} {data_id}: quota exhausted (402)")
            return []
        r.raise_for_status()
        j = r.json()
        if j.get("msg") != "success":
            logger.warning(f"FinMind {dataset} {data_id}: {j.get('msg')}")
            return []
        return j.get("data", []) or []
    except Exception as e:
        logger.warning(f"FinMind {dataset} {data_id} error: {e}")
        return []


# ── Quarterly EPS / financials ─────────────────────────────────────────────────

def fetch_quarterly_financials(symbol: str, since_year: int = 2022) -> list[dict]:
    """
    Returns records with 'date' (quarter-end YYYY-MM-DD), 'type' and 'value'.
    We're primarily interested in type == 'EPS' (basic EPS per quarter).
    """
    return _fetch("TaiwanStockFinancialStatements", symbol, f"{since_year}-01-01")


def extract_quarterly_eps(rows: list[dict]) -> list[tuple[str, float, float | None]]:
    """Extract (period_end, basic_eps, diluted_eps) — FinMind only has basic."""
    out = []
    for r in rows:
        if r.get("type") != "EPS":
            continue
        v = r.get("value")
        if v is None:
            continue
        out.append((r["date"], float(v), None))
    # Sort by period_end desc (FinMind returns chronological; reverse here)
    out.sort(key=lambda x: x[0], reverse=True)
    return out


# ── Monthly revenue ────────────────────────────────────────────────────────────

def fetch_monthly_revenue(symbol: str, since_year: int = 2023) -> list[dict]:
    """
    Returns rows with keys: date, revenue, revenue_month, revenue_year.
    NB: 'date' is the report-release date (1 month after the actual revenue
    month); use (revenue_year, revenue_month) as the period key.
    """
    return _fetch("TaiwanStockMonthRevenue", symbol, f"{since_year}-01-01")


def latest_monthly_revenue_yoy(rows: list[dict]) -> dict | None:
    """
    Compute the most recent month's revenue YoY % given all monthly rows.
    Returns {period: 'YYYY-MM', revenue, yoy_pct, prev_year_revenue} or None.
    """
    if not rows:
        return None
    # Sort by actual revenue month (revenue_year, revenue_month)
    rows_sorted = sorted(
        rows, key=lambda r: (r.get("revenue_year", 0), r.get("revenue_month", 0)),
    )
    latest = rows_sorted[-1]
    y, m, rev = latest.get("revenue_year"), latest.get("revenue_month"), latest.get("revenue")
    if y is None or m is None or rev is None:
        return None
    # Find same month, previous year
    prev = next(
        (r for r in rows_sorted if r.get("revenue_year") == y - 1 and r.get("revenue_month") == m),
        None,
    )
    if prev is None or not prev.get("revenue"):
        return {"period": f"{y:04d}-{m:02d}", "revenue": rev, "yoy_pct": None, "prev_year_revenue": None}
    pv = prev["revenue"]
    yoy_pct = (rev - pv) / pv * 100 if pv else None
    return {
        "period": f"{y:04d}-{m:02d}",
        "revenue": rev,
        "yoy_pct": yoy_pct,
        "prev_year_revenue": pv,
    }


# ── Dividends ──────────────────────────────────────────────────────────────────

def fetch_dividends(symbol: str, since_year: int = 2020) -> list[dict]:
    """
    Returns rows with 'date' and 'CashEarningsDistribution' / 'StockEarningsDistribution'.
    """
    return _fetch("TaiwanStockDividend", symbol, f"{since_year}-01-01")


def trailing_12m_cash_dividend(rows: list[dict], as_of: datetime | None = None) -> float:
    """Sum of cash dividends paid in the last 365 days."""
    if not rows:
        return 0.0
    cutoff = (as_of or datetime.now()) - timedelta(days=365)
    total = 0.0
    for r in rows:
        try:
            d = datetime.strptime(r["date"], "%Y-%m-%d")
        except Exception:
            continue
        if d < cutoff:
            continue
        v = r.get("CashEarningsDistribution")
        if v is None:
            continue
        try:
            total += float(v)
        except Exception:
            continue
    return total


# ── Full stock refresh helper ─────────────────────────────────────────────────

def refresh_one_stock_from_finmind(symbol: str, current_price: float | None) -> dict:
    """
    Fetch quarterly EPS, monthly revenue and dividends for one symbol and
    persist to DB. Returns a summary of what was written.
    """
    # 1) Quarterly EPS → eps_quarterly (overwrites yfinance values)
    q_rows = fetch_quarterly_financials(symbol)
    eps_records = extract_quarterly_eps(q_rows)
    time.sleep(random.uniform(*SLEEP_RANGE))

    # 2) Monthly revenue → monthly_revenue
    mr_rows = fetch_monthly_revenue(symbol)
    time.sleep(random.uniform(*SLEEP_RANGE))

    # 3) Dividends
    div_rows = fetch_dividends(symbol)

    # Derive metrics
    ttm_eps = None
    if len(eps_records) >= 4:
        ttm_eps = round(sum(r[1] for r in eps_records[:4]), 4)

    mr_summary = latest_monthly_revenue_yoy(mr_rows)
    yoy_pct = mr_summary["yoy_pct"] if mr_summary else None

    ttm_div = trailing_12m_cash_dividend(div_rows)
    ttm_div_yield_pct = None
    if current_price and current_price > 0:
        ttm_div_yield_pct = (ttm_div / current_price) * 100

    # Persist
    conn = get_connection()
    try:
        # EPS quarterly — upsert
        for period_end, basic, diluted in eps_records:
            conn.execute(
                """INSERT OR REPLACE INTO eps_quarterly
                   (symbol, period_end, basic_eps, diluted_eps)
                   VALUES (?, ?, ?, ?)""",
                (symbol, period_end, basic, diluted),
            )
        # Monthly revenue
        for r in mr_rows:
            y, m = r.get("revenue_year"), r.get("revenue_month")
            rev = r.get("revenue")
            if y is None or m is None or rev is None:
                continue
            conn.execute(
                """INSERT OR REPLACE INTO monthly_revenue
                   (symbol, year, month, revenue)
                   VALUES (?, ?, ?, ?)""",
                (symbol, int(y), int(m), int(rev)),
            )
        # Dividends
        for r in div_rows:
            conn.execute(
                """INSERT OR REPLACE INTO dividends
                   (symbol, date, cash, stock)
                   VALUES (?, ?, ?, ?)""",
                (symbol, r["date"],
                 float(r.get("CashEarningsDistribution") or 0),
                 float(r.get("StockEarningsDistribution") or 0)),
            )
        # Metadata (fundamentals)
        conn.execute(
            """UPDATE metadata SET
                 ttm_eps = ?, monthly_revenue_yoy = ?,
                 ttm_dividend = ?, ttm_dividend_yield = ?, last_updated = ?
               WHERE symbol = ?""",
            (ttm_eps, yoy_pct, ttm_div, ttm_div_yield_pct,
             datetime.now().isoformat(), symbol),
        )
        conn.commit()
    finally:
        conn.close()

    return {
        "symbol": symbol,
        "eps_quarters": len(eps_records),
        "ttm_eps": ttm_eps,
        "monthly_period": mr_summary["period"] if mr_summary else None,
        "monthly_yoy_pct": yoy_pct,
        "ttm_dividend": ttm_div,
        "ttm_dividend_yield_pct": ttm_div_yield_pct,
    }


def ensure_finmind_current(stale_hours: float = 24.0) -> dict:
    """
    Startup sweep: for every enabled stock whose monthly_revenue_yoy is missing
    or stale, refetch from FinMind. Runs serially to respect rate limits.
    """
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT s.symbol, m.last_updated, m.monthly_revenue_yoy
               FROM stocks s
               LEFT JOIN metadata m ON s.symbol = m.symbol
               WHERE s.enabled = 1"""
        ).fetchall()
    finally:
        conn.close()

    cutoff = datetime.now() - timedelta(hours=stale_hours)
    targets = []
    for r in rows:
        # Always refresh if missing YoY; otherwise check staleness
        if r["monthly_revenue_yoy"] is None:
            targets.append(r["symbol"])
            continue
        lu = r["last_updated"]
        if not lu:
            targets.append(r["symbol"])
            continue
        try:
            if datetime.fromisoformat(lu.replace("Z", "+00:00").replace("+00:00", "")) < cutoff:
                targets.append(r["symbol"])
        except Exception:
            targets.append(r["symbol"])

    if not targets:
        logger.info("ensure_finmind_current: all stocks fresh")
        return {"targets": 0, "success": 0, "failed": []}

    logger.info(f"ensure_finmind_current: {len(targets)}/{len(rows)} stocks need FinMind refresh")
    success = 0
    failed = []
    for i, sym in enumerate(targets):
        # Get last close for dividend yield calc
        conn = get_connection()
        try:
            row = conn.execute(
                "SELECT close FROM klines WHERE symbol=? ORDER BY date DESC LIMIT 1",
                (sym,),
            ).fetchone()
            price = row["close"] if row else None
        finally:
            conn.close()
        try:
            r = refresh_one_stock_from_finmind(sym, price)
            logger.info(
                f"  [{i+1}/{len(targets)}] {sym}: TTM EPS={r['ttm_eps']}, "
                f"{r['monthly_period']} YoY={r['monthly_yoy_pct']:.1f}% "
                f"DivY={r['ttm_dividend_yield_pct']}" if r["monthly_yoy_pct"] is not None
                else f"  [{i+1}/{len(targets)}] {sym}: TTM EPS={r['ttm_eps']} (no YoY)"
            )
            success += 1
        except Exception as e:
            logger.error(f"  [{i+1}/{len(targets)}] {sym} failed: {e}")
            failed.append(sym)
        time.sleep(random.uniform(*SLEEP_RANGE))

    logger.info(f"ensure_finmind_current done: {success} ok, {len(failed)} failed")
    return {"targets": len(targets), "success": success, "failed": failed}
