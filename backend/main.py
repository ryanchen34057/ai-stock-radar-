import logging
import sys
import threading
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
import pytz

from app.database import init_schema, load_settings_to_env, DB_PATH, get_connection
from app.api.routes import router
from app.services.stock_service import seed_stocks_table, update_all_stocks, fetch_missing_klines, fetch_logos_from_tradingview, ensure_klines_current, ensure_eps_current
from app.services.youtube_service import run_youtube_pipeline
from app.services.news_service import refresh_all_news
from app.services.finmind_service import ensure_finmind_current
from app.services.disposal_service import ensure_disposal_current, refresh_disposal_list
from app.services.institutional_service import backfill_institutional_history
from app.services import setup_progress
from app.services import fb_service, kol_service, twse_mis_service

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

    # Startup sweep: bring every stock up to today, then fill in EPS. Runs
    # serially in one background thread — parallel yfinance calls get rate-limited.
    def _startup_data_sweep():
        setup_progress.begin_sweep()
        try:
            setup_progress.begin("klines")
            ensure_klines_current(backfill_period="5y")
            setup_progress.mark_phase_done("klines")
        except Exception as e:
            logger.error(f"ensure_klines_current failed: {e}")
            setup_progress.report_error(f"K 線抓取失敗：{e}")
        try:
            setup_progress.begin("eps")
            ensure_eps_current()
            setup_progress.mark_phase_done("eps")
        except Exception as e:
            logger.error(f"ensure_eps_current failed: {e}")
            setup_progress.report_error(f"EPS 抓取失敗：{e}")
        try:
            setup_progress.begin("finmind")
            ensure_finmind_current(stale_hours=24.0)
            setup_progress.mark_phase_done("finmind")
        except Exception as e:
            logger.error(f"ensure_finmind_current failed: {e}")
            setup_progress.report_error(f"FinMind 抓取失敗：{e}")
        try:
            setup_progress.begin("disposal")
            ensure_disposal_current(max_age_hours=12.0)
            setup_progress.mark_phase_done("disposal")
        except Exception as e:
            logger.error(f"ensure_disposal_current failed: {e}")
        try:
            setup_progress.begin("institutional")
            backfill_institutional_history(days=20)
            setup_progress.mark_phase_done("institutional")
        except Exception as e:
            logger.error(f"institutional backfill failed: {e}")
        setup_progress.mark_all_done()

    threading.Thread(target=_startup_data_sweep, daemon=True).start()

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

    # Monthly revenue reports are published by the 10th of each month — run
    # FinMind sweep daily at 20:00 so fresh reports surface the same evening.
    scheduler.add_job(
        lambda: ensure_finmind_current(stale_hours=0.0),
        CronTrigger(hour=20, minute=0, timezone="Asia/Taipei"),
        id="daily_finmind",
        replace_existing=True,
    )

    # 處置股公告通常在盤前更新，07:30 拉一次即可涵蓋當日
    scheduler.add_job(
        lambda: refresh_disposal_list(),
        CronTrigger(hour=7, minute=30, timezone="Asia/Taipei"),
        id="daily_disposal",
        replace_existing=True,
    )

    # 三大法人 / 融資融券 — 台股盤後 16:00 ~ 16:30 publish，17:30 拉一次補到 cache
    scheduler.add_job(
        lambda: backfill_institutional_history(days=3),
        CronTrigger(hour=17, minute=30, timezone="Asia/Taipei"),
        id="daily_institutional",
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

    # ── Rolling auto-refresh ──────────────────────────────────────────────
    # Cheap "is there anything new?" polls. Each service's refresh function
    # already short-circuits when nothing has changed (FB skips already-
    # analysed posts; KOL skips already-summarised videos; stocks use the
    # incremental path). So the cost when nothing is new is near-zero.

    # FB every 15 min — Playwright is heavy (~30s, ~300MB RAM) and FB will
    # throttle faster cadence.
    scheduler.add_job(
        lambda: fb_service.refresh_all_pages(days=7),
        IntervalTrigger(minutes=15, timezone="Asia/Taipei"),
        id="fb_poll",
        replace_existing=True,
        max_instances=1,       # never run two at once
        coalesce=True,         # if missed (laptop asleep), run once on wake
    )

    # KOL every 5 min — YouTube API calls are cheap (1 unit per channel);
    # NotebookLM only fires on brand-new videos.
    scheduler.add_job(
        lambda: kol_service.refresh_all_kol_feeds(days=7),
        IntervalTrigger(minutes=5, timezone="Asia/Taipei"),
        id="kol_poll",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )

    # Stocks every 5 min during TW market hours (09:00–13:30, Mon–Fri).
    # Uses TWSE MIS for true real-time intraday prices (yfinance doesn't
    # reliably give intraday bars for TW stocks during session).
    scheduler.add_job(
        lambda: twse_mis_service.refresh_all_quotes(),
        CronTrigger(day_of_week="mon-fri", hour="9-13", minute="*/5",
                    timezone="Asia/Taipei"),
        id="stocks_intraday_mis",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )

    # Also do one MIS pull at startup so the dashboard shows live prices
    # immediately (if we're inside market hours).
    threading.Thread(target=twse_mis_service.refresh_all_quotes, daemon=True).start()

    scheduler.start()
    logger.info("APScheduler started – FB 15min / KOL 5min / stocks 5min (mkt hrs) / daily jobs 18:00+")

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


# ── Static frontend serving (production / Electron builds) ────────────────────
# If frontend/dist exists, serve the built React app from the backend.
# This way the Electron wrapper just points at http://127.0.0.1:8000/.
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os as _os

_FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"
# Also check a sibling path used by Electron's bundled layout (electron/resources/frontend)
_ELECTRON_DIST = Path(__file__).parent.parent / "frontend" / "dist"
if _os.environ.get("FRONTEND_DIST_DIR"):
    _FRONTEND_DIST = Path(_os.environ["FRONTEND_DIST_DIR"])

if _FRONTEND_DIST.is_dir():
    # Mount /assets (Vite's chunked JS/CSS/images) verbatim
    app.mount("/assets", StaticFiles(directory=str(_FRONTEND_DIST / "assets")), name="assets")

    @app.get("/favicon.svg")
    @app.get("/favicon.ico")
    def _favicon():
        for name in ("favicon.svg", "favicon.ico"):
            p = _FRONTEND_DIST / name
            if p.exists():
                return FileResponse(p)
        raise HTTPException(status_code=404)  # noqa: F821

    # Catch-all: serve index.html for the SPA, BUT only for non-/api paths so
    # API 404s still return JSON. Registered LAST to avoid shadowing routes.
    @app.get("/{full_path:path}")
    def _spa_fallback(full_path: str):
        if full_path.startswith(("api/", "api")):
            raise HTTPException(status_code=404)  # noqa: F821
        idx = _FRONTEND_DIST / "index.html"
        if idx.exists():
            return FileResponse(idx)
        raise HTTPException(status_code=404)  # noqa: F821

    logger.info(f"Serving frontend from {_FRONTEND_DIST}")
else:
    logger.info(f"Frontend dist not found at {_FRONTEND_DIST}; API-only mode")
