"""
Daily incremental update script. Run manually or let APScheduler handle it.
Usage: cd backend && python -m scripts.daily_update
"""
import sys
import logging
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database import init_schema
from app.services.stock_service import update_all_stocks

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s – %(message)s")
logger = logging.getLogger(__name__)


def main():
    logger.info("=== Daily Update Started ===")
    init_schema()
    result = update_all_stocks(period="5d")
    logger.info(f"Done: {result['success']} updated, {len(result['failed'])} failed")
    if result['failed']:
        logger.warning(f"Failed symbols: {result['failed']}")


if __name__ == "__main__":
    main()
