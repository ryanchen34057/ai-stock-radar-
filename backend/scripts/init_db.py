"""
Initialize the database and fetch historical data.

Usage:
  python -m scripts.init_db            # full init (all 66 stocks, 5 years)
  python -m scripts.init_db --retry    # only re-fetch stocks with no data in DB
"""
import sys
import logging
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database import init_schema, DB_PATH, get_connection
from app.services.stock_service import seed_stocks_table, update_all_stocks, fetch_yfinance, upsert_klines, upsert_metadata

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s – %(message)s")
logger = logging.getLogger(__name__)


def get_missing_symbols() -> list[str]:
    """Return symbols that have no kline data in the DB."""
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT s.symbol FROM stocks s
               LEFT JOIN (
                   SELECT symbol, COUNT(*) as cnt FROM klines GROUP BY symbol
               ) k ON s.symbol = k.symbol
               WHERE k.cnt IS NULL OR k.cnt = 0
               ORDER BY s.layer, s.symbol"""
        ).fetchall()
        return [r["symbol"] for r in rows]
    finally:
        conn.close()


def retry_missing(period: str = "5y"):
    """Re-fetch only stocks that have no klines."""
    import time, random
    missing = get_missing_symbols()
    if not missing:
        logger.info("No missing stocks — all 66 already have data.")
        return {"success": 0, "failed": []}

    logger.info(f"Found {len(missing)} stocks with no data: {missing}")
    success, failed = 0, []

    for i, symbol in enumerate(missing):
        logger.info(f"[{i+1}/{len(missing)}] Retrying {symbol}")
        try:
            df, info = fetch_yfinance(symbol, period)
            if df is not None and not df.empty:
                upsert_klines(symbol, df)
                upsert_metadata(symbol, info)
                success += 1
            else:
                failed.append(symbol)
        except Exception as e:
            logger.error(f"Error {symbol}: {e}")
            failed.append(symbol)
        time.sleep(random.uniform(2.0, 4.0))

    logger.info(f"Retry done: {success} recovered, {len(failed)} still failed: {failed}")
    return {"success": success, "failed": failed}


def main():
    retry_mode = "--retry" in sys.argv

    logger.info("=== AI Stock Radar — Database Init ===")
    logger.info(f"DB location: {DB_PATH}")
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    init_schema()
    seed_stocks_table()

    if retry_mode:
        logger.info("Mode: retry missing stocks only")
        result = retry_missing(period="5y")
    else:
        logger.info("Mode: full init — fetching 5-year data for all 66 stocks")
        logger.info("Estimated time: 20-30 minutes (with polite delays to avoid rate limits)")
        result = update_all_stocks(period="5y")

    logger.info("=== Done ===")
    logger.info(f"Success: {result['success']}  Failed: {len(result['failed'])}")
    if result["failed"]:
        logger.warning(f"Failed symbols: {result['failed']}")
        logger.info("Tip: run  python -m scripts.init_db --retry  to re-fetch failed ones")
    else:
        logger.info("All stocks fetched successfully!")
    logger.info("Start server: uvicorn main:app --reload")


if __name__ == "__main__":
    main()
