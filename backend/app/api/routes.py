from fastapi import APIRouter, HTTPException, Query
from app.services.stock_service import get_dashboard_data, update_all_stocks, load_stocks_json
from app.services.institutional_service import get_institutional_data
from app.database import get_connection
from datetime import datetime, timezone
import logging

router = APIRouter(prefix="/api")
logger = logging.getLogger(__name__)


@router.get("/stocks")
def list_stocks():
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT symbol, name, layer, layer_name, sub_category, note FROM stocks ORDER BY layer, symbol"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@router.get("/stocks/{symbol}")
def get_stock(symbol: str):
    conn = get_connection()
    try:
        stock = conn.execute("SELECT * FROM stocks WHERE symbol = ?", (symbol,)).fetchone()
        if not stock:
            raise HTTPException(status_code=404, detail="Stock not found")

        kline_rows = conn.execute(
            """SELECT date, open, high, low, close, volume FROM klines
               WHERE symbol = ? ORDER BY date DESC LIMIT 240""",
            (symbol,)
        ).fetchall()
        klines = list(reversed([dict(r) for r in kline_rows]))

        meta = conn.execute("SELECT * FROM metadata WHERE symbol = ?", (symbol,)).fetchone()

        closes = [k["close"] for k in klines]
        ma_values = {}
        for p in [5, 10, 20, 60, 120, 240]:
            if len(closes) >= p:
                ma_values[str(p)] = round(sum(closes[-p:]) / p, 2)
            else:
                ma_values[str(p)] = None

        return {
            **dict(stock),
            "ma": ma_values,
            "klines": klines[-60:],
            "pe_ratio": dict(meta)["pe_ratio"] if meta else None,
            "market_cap": dict(meta)["market_cap"] if meta else None,
        }
    finally:
        conn.close()


@router.get("/stocks/{symbol}/klines")
def get_klines(symbol: str, days: int = Query(default=1300, ge=1, le=1300)):
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT date, open, high, low, close, volume FROM klines
               WHERE symbol = ? ORDER BY date DESC LIMIT ?""",
            (symbol, days)
        ).fetchall()
        return list(reversed([dict(r) for r in rows]))
    finally:
        conn.close()


@router.get("/dashboard")
def get_dashboard():
    try:
        return get_dashboard_data()
    except Exception as e:
        logger.error(f"Dashboard error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/refresh")
def refresh_data(full: bool = False):
    """
    full=false (default): fetch last 5d (daily update)
    full=true: re-fetch 5y for all stocks
    """
    try:
        result = update_all_stocks(period="5y" if full else "5d")
        return {"status": "ok", **result}
    except Exception as e:
        logger.error(f"Refresh error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/institutional")
def get_institutional(date: str | None = Query(default=None, description="YYYYMMDD, default=last weekday")):
    """
    Return three-institution (外資/投信/自營商) buy/sell and margin trading
    (融資/融券) data for all stocks, sourced from TWSE and TPEx public APIs.
    """
    try:
        result = get_institutional_data(date)

        # Cache in DB
        conn = get_connection()
        try:
            rows = []
            for sym, d in result["stocks"].items():
                rows.append((sym, result["date"],
                             d["foreign_net"], d["trust_net"],
                             d["dealer_net"],  d["total_net"],
                             d["margin_balance"], d["margin_change"],
                             d["short_balance"],  d["short_change"]))
            conn.executemany(
                """INSERT OR REPLACE INTO institutional_cache
                   (symbol, date, foreign_net, trust_net, dealer_net, total_net,
                    margin_balance, margin_change, short_balance, short_change)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                rows,
            )
            conn.commit()
        finally:
            conn.close()

        return result
    except Exception as e:
        logger.error(f"Institutional data error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/last-update")
def last_update():
    conn = get_connection()
    try:
        row = conn.execute("SELECT MAX(last_updated) as t FROM metadata").fetchone()
        return {
            "last_updated": row["t"] if row and row["t"] else None,
            "status": "ok"
        }
    finally:
        conn.close()
