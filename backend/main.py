import logging
import sys
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
import pytz

from app.database import init_schema, DB_PATH
from app.api.routes import router
from app.services.stock_service import seed_stocks_table, update_all_stocks

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
    seed_stocks_table()

    # Schedule daily update at 18:00 Taipei time
    scheduler.add_job(
        lambda: update_all_stocks(period="5d"),
        CronTrigger(hour=18, minute=0, timezone="Asia/Taipei"),
        id="daily_update",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("APScheduler started – daily update at 18:00 Asia/Taipei")

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
