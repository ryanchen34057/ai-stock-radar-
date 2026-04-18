import logging
import sys
import threading
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
import pytz

from app.database import init_schema, load_settings_to_env, DB_PATH, get_connection
from app.api.routes import router
from app.services.stock_service import seed_stocks_table, update_all_stocks, fetch_missing_klines, fetch_logos_from_tradingview
from app.services.youtube_service import run_youtube_pipeline
from app.services.news_service import refresh_all_news

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s – %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler(timezone=pytz.timezone("Asia/Taipei"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info(f"DB path: {DB_PATH}")
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    init_schema()
    load_settings_to_env()
    seed_stocks_table()

    # Auto-fetch klines for any stock with incomplete data (background, non-blocking).
    # min_rows=1000 catches both "no klines" AND "only a few rows from daily update".
    # The IPO-date check inside fetch_missing_klines skips genuinely newly-listed stocks,
    # so we don't re-fetch them every startup.
    threading.Thread(
        target=fetch_missing_klines,
        kwargs={"period": "5y", "min_rows": 1000},
        daemon=True,
    ).start()

    # Fetch missing logos from TradingView (fast — single API call)
    threading.Thread(target=fetch_logos_from_tradingview, daemon=True).start()

    # Refresh news cache for all stocks (background, 1-2s per stock)
    def _news_refresh_job():
        c = get_connection()
        try:
            refresh_all_news(c, skip_fresh_hours=6)
        finally:
            c.close()
    threading.Thread(target=_news_refresh_job, daemon=True).start()

    scheduler.add_job(
        _news_refresh_job,
        CronTrigger(hour=9, minute=0, timezone="Asia/Taipei"),
        id="daily_news_refresh",
        replace_existing=True,
    )

    # Schedule daily stock update at 18:00 Taipei time
    scheduler.add_job(
        lambda: update_all_stocks(period="5d"),
        CronTrigger(hour=18, minute=0, timezone="Asia/Taipei"),
        id="daily_update",
        replace_existing=True,
    )

    # Schedule YouTube pipeline at 18:30 Taipei time (show uploads ~18:00)
    def _yt_job():
        conn = get_connection()
        try:
            run_youtube_pipeline(conn)
        except Exception as e:
            logger.error(f"YouTube scheduled job failed: {e}")
        finally:
            conn.close()

    scheduler.add_job(
        _yt_job,
        CronTrigger(hour=18, minute=30, timezone="Asia/Taipei"),
        id="youtube_pipeline",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("APScheduler started – stock update 18:00 / YouTube 18:30 Asia/Taipei")

    yield

    # Shutdown
    scheduler.shutdown()
    logger.info("Scheduler stopped")


app = FastAPI(
    title="AI 產業鏈股票雷達 API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/health")
def health():
    return {"status": "ok"}
