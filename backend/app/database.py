import os
import sqlite3
from pathlib import Path

# DB location resolution:
#   1. $USER_DATA_DIR env var (set by the Electron wrapper to %APPDATA%\AI-Stock-Radar
#      so a packaged install doesn't try to write inside Program Files)
#   2. Fall back to <repo>/backend/data/stocks.db (dev mode)
_env_data = os.environ.get("USER_DATA_DIR")
if _env_data:
    _DATA_DIR = Path(_env_data)
else:
    _DATA_DIR = Path(__file__).parent.parent.parent / "data"
_DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = _DATA_DIR / "stocks.db"


def get_connection() -> sqlite3.Connection:
    """Return a sqlite3 connection with row_factory set to sqlite3.Row.

    Concurrency settings:
      - WAL journal mode allows one writer + many readers in parallel (the
        default rollback journal blocks all readers during writes).
      - busy_timeout=5s makes SQLite wait-and-retry instead of immediately
        raising OperationalError when a lock is held by another connection.
        This lets APScheduler's FB/KOL background jobs coexist with
        user-initiated writes (add_page, settings save, etc.).
      - synchronous=NORMAL is safe with WAL and faster than FULL.
    """
    conn = sqlite3.connect(str(DB_PATH), timeout=5.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def init_schema():
    """Create all tables and indexes if they do not already exist."""
    conn = get_connection()
    try:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS stocks (
                symbol TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                layer INTEGER NOT NULL,
                layer_name TEXT NOT NULL,
                sub_category TEXT,
                note TEXT,
                theme TEXT NOT NULL DEFAULT 'A',
                themes TEXT DEFAULT NULL,
                industry_role TEXT DEFAULT NULL,
                secondary_layers TEXT DEFAULT NULL,
                logo_id TEXT DEFAULT NULL,
                tier INTEGER NOT NULL DEFAULT 2,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS klines (
                symbol TEXT,
                date TEXT,
                open REAL,
                high REAL,
                low REAL,
                close REAL,
                volume INTEGER,
                PRIMARY KEY (symbol, date),
                FOREIGN KEY (symbol) REFERENCES stocks(symbol)
            );

            CREATE TABLE IF NOT EXISTS metadata (
                symbol TEXT PRIMARY KEY,
                pe_ratio REAL,
                market_cap REAL,
                eps_current_year REAL,
                eps_forward REAL,
                forward_pe REAL,
                last_updated TEXT,
                FOREIGN KEY (symbol) REFERENCES stocks(symbol)
            );

            CREATE INDEX IF NOT EXISTS idx_klines_symbol_date ON klines(symbol, date);

            CREATE TABLE IF NOT EXISTS app_settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS news_cache (
                symbol      TEXT PRIMARY KEY,
                fetched_at  TEXT NOT NULL,
                mops_json   TEXT NOT NULL DEFAULT '[]',
                news_json   TEXT NOT NULL DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS youtube_mentions (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                video_id      TEXT NOT NULL,
                video_title   TEXT NOT NULL,
                video_url     TEXT NOT NULL,
                video_date    DATE NOT NULL,
                stock_symbol  TEXT NOT NULL,
                stock_name    TEXT NOT NULL DEFAULT '',
                summary       TEXT NOT NULL DEFAULT '',
                timestamp_sec INTEGER NOT NULL DEFAULT 0,
                sentiment     TEXT NOT NULL DEFAULT 'neutral',
                UNIQUE(video_id, stock_symbol)
            );

            CREATE INDEX IF NOT EXISTS idx_yt_date ON youtube_mentions(video_date);

            CREATE TABLE IF NOT EXISTS kol_channels (
                channel_id  TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                description TEXT DEFAULT '',
                enabled     INTEGER NOT NULL DEFAULT 1,
                created_at  TEXT DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS kol_videos (
                video_id          TEXT PRIMARY KEY,
                channel_id        TEXT NOT NULL,
                channel_name      TEXT DEFAULT '',
                title             TEXT DEFAULT '',
                url               TEXT DEFAULT '',
                thumbnail         TEXT DEFAULT '',
                published_at      TEXT DEFAULT '',
                summary           TEXT DEFAULT '',
                stocks_json       TEXT DEFAULT '[]',
                overall_sentiment TEXT DEFAULT 'neutral',
                summariser        TEXT DEFAULT '',
                processed_at      TEXT DEFAULT ''
            );

            CREATE INDEX IF NOT EXISTS idx_kol_videos_pub ON kol_videos(published_at);
            CREATE INDEX IF NOT EXISTS idx_kol_videos_channel ON kol_videos(channel_id);

            CREATE TABLE IF NOT EXISTS fb_pages (
                id          TEXT PRIMARY KEY,
                url         TEXT NOT NULL UNIQUE,
                name        TEXT DEFAULT '',
                kind        TEXT DEFAULT 'page',
                enabled     INTEGER NOT NULL DEFAULT 1,
                created_at  TEXT DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS fb_posts (
                post_id           TEXT PRIMARY KEY,
                page_id           TEXT NOT NULL,
                page_name         TEXT DEFAULT '',
                content           TEXT DEFAULT '',
                posted_at         TEXT DEFAULT '',
                url               TEXT DEFAULT '',
                images_json       TEXT DEFAULT '[]',
                reactions_count   INTEGER DEFAULT 0,
                comments_count    INTEGER DEFAULT 0,
                processed_at      TEXT DEFAULT '',
                summary           TEXT DEFAULT '',
                stocks_json       TEXT DEFAULT '[]',
                overall_sentiment TEXT DEFAULT 'neutral',
                summariser        TEXT DEFAULT ''
            );

            CREATE INDEX IF NOT EXISTS idx_fb_posts_page ON fb_posts(page_id);
            CREATE INDEX IF NOT EXISTS idx_fb_posts_posted ON fb_posts(posted_at);

            CREATE TABLE IF NOT EXISTS disposed_stocks (
                symbol      TEXT NOT NULL,
                name        TEXT DEFAULT '',
                reason      TEXT DEFAULT '',
                measure     TEXT DEFAULT '',
                start_date  TEXT NOT NULL,
                end_date    TEXT NOT NULL,
                source      TEXT DEFAULT '',
                fetched_at  TEXT DEFAULT '',
                PRIMARY KEY (symbol, start_date, end_date)
            );
            CREATE INDEX IF NOT EXISTS idx_disposed_dates ON disposed_stocks(start_date, end_date);

            CREATE TABLE IF NOT EXISTS business_cycle_cache (
                date       TEXT PRIMARY KEY,
                data_json  TEXT NOT NULL,
                fetched_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS business_cycle_percentiles (
                indicator_key TEXT PRIMARY KEY,
                p20           REAL NOT NULL,
                p40           REAL NOT NULL,
                p60           REAL NOT NULL,
                p80           REAL NOT NULL,
                direction     TEXT NOT NULL DEFAULT 'higher_is_better',
                sample_count  INTEGER NOT NULL,
                computed_at   TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS eps_annual (
                symbol      TEXT,
                year        INTEGER,
                basic_eps   REAL,
                diluted_eps REAL,
                PRIMARY KEY (symbol, year),
                FOREIGN KEY (symbol) REFERENCES stocks(symbol)
            );

            CREATE TABLE IF NOT EXISTS eps_quarterly (
                symbol      TEXT,
                period_end  TEXT,
                basic_eps   REAL,
                diluted_eps REAL,
                PRIMARY KEY (symbol, period_end),
                FOREIGN KEY (symbol) REFERENCES stocks(symbol)
            );

            CREATE TABLE IF NOT EXISTS monthly_revenue (
                symbol  TEXT,
                year    INTEGER,
                month   INTEGER,
                revenue INTEGER,
                PRIMARY KEY (symbol, year, month),
                FOREIGN KEY (symbol) REFERENCES stocks(symbol)
            );

            CREATE TABLE IF NOT EXISTS dividends (
                symbol TEXT,
                date   TEXT,
                cash   REAL,
                stock  REAL,
                PRIMARY KEY (symbol, date),
                FOREIGN KEY (symbol) REFERENCES stocks(symbol)
            );

            CREATE TABLE IF NOT EXISTS institutional_cache (
                symbol      TEXT,
                date        TEXT,
                foreign_net INTEGER DEFAULT 0,
                trust_net   INTEGER DEFAULT 0,
                dealer_net  INTEGER DEFAULT 0,
                total_net   INTEGER DEFAULT 0,
                margin_balance INTEGER DEFAULT 0,
                margin_change  INTEGER DEFAULT 0,
                short_balance  INTEGER DEFAULT 0,
                short_change   INTEGER DEFAULT 0,
                PRIMARY KEY (symbol, date)
            );

            -- TDCC 集保 weekly 股權分散 -- level 15 = 1,000,001股 以上 = 千張大戶
            CREATE TABLE IF NOT EXISTS shareholding_weekly (
                symbol           TEXT NOT NULL,
                date             TEXT NOT NULL,   -- YYYYMMDD as published by TDCC
                big_holder_count INTEGER DEFAULT 0,
                big_holder_pct   REAL DEFAULT 0,
                PRIMARY KEY (symbol, date)
            );
            CREATE INDEX IF NOT EXISTS idx_shareholding_symbol ON shareholding_weekly(symbol);
        """)
        conn.commit()

        # Migrations for existing databases
        existing_cols = {row[1] for row in conn.execute("PRAGMA table_info(youtube_mentions)").fetchall()}
        if "sentiment" not in existing_cols:
            conn.execute("ALTER TABLE youtube_mentions ADD COLUMN sentiment TEXT NOT NULL DEFAULT 'neutral'")
            conn.commit()
        existing_fb_cols = {row[1] for row in conn.execute("PRAGMA table_info(fb_posts)").fetchall()}
        for col, ddl in [
            ("summary",           "TEXT DEFAULT ''"),
            ("stocks_json",       "TEXT DEFAULT '[]'"),
            ("overall_sentiment", "TEXT DEFAULT 'neutral'"),
            ("summariser",        "TEXT DEFAULT ''"),
        ]:
            if col not in existing_fb_cols:
                conn.execute(f"ALTER TABLE fb_posts ADD COLUMN {col} {ddl}")
                conn.commit()
        existing_stock_cols = {row[1] for row in conn.execute("PRAGMA table_info(stocks)").fetchall()}
        if "theme" not in existing_stock_cols:
            conn.execute("ALTER TABLE stocks ADD COLUMN theme TEXT NOT NULL DEFAULT 'A'")
            conn.commit()
        if "themes" not in existing_stock_cols:
            conn.execute("ALTER TABLE stocks ADD COLUMN themes TEXT DEFAULT NULL")
            conn.commit()
        if "industry_role" not in existing_stock_cols:
            conn.execute("ALTER TABLE stocks ADD COLUMN industry_role TEXT DEFAULT NULL")
            conn.commit()
        if "secondary_layers" not in existing_stock_cols:
            conn.execute("ALTER TABLE stocks ADD COLUMN secondary_layers TEXT DEFAULT NULL")
            conn.commit()
        if "logo_id" not in existing_stock_cols:
            conn.execute("ALTER TABLE stocks ADD COLUMN logo_id TEXT DEFAULT NULL")
            conn.commit()
        existing_meta_cols = {row[1] for row in conn.execute("PRAGMA table_info(metadata)").fetchall()}
        for col in ("eps_current_year", "eps_forward", "forward_pe",
                    "dividend_yield", "pb_ratio", "roe", "revenue_growth",
                    "ttm_eps", "monthly_revenue_yoy",
                    "ttm_dividend", "ttm_dividend_yield"):
            if col not in existing_meta_cols:
                conn.execute(f"ALTER TABLE metadata ADD COLUMN {col} REAL")
                conn.commit()
        # v1.3 — tier / enabled / timestamps on stocks table
        if "tier" not in existing_stock_cols:
            conn.execute("ALTER TABLE stocks ADD COLUMN tier INTEGER NOT NULL DEFAULT 2")
            conn.commit()
        if "enabled" not in existing_stock_cols:
            conn.execute("ALTER TABLE stocks ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1")
            conn.commit()
        if "created_at" not in existing_stock_cols:
            conn.execute("ALTER TABLE stocks ADD COLUMN created_at TEXT")
            conn.commit()
        if "updated_at" not in existing_stock_cols:
            conn.execute("ALTER TABLE stocks ADD COLUMN updated_at TEXT")
            conn.commit()
        existing_kol_cols = {row[1] for row in conn.execute("PRAGMA table_info(kol_videos)").fetchall()}
        if existing_kol_cols and "summariser" not in existing_kol_cols:
            conn.execute("ALTER TABLE kol_videos ADD COLUMN summariser TEXT DEFAULT ''")
            conn.commit()
    finally:
        conn.close()


def load_settings_to_env():
    """Load API keys from app_settings table into os.environ (overrides .env values)."""
    conn = get_connection()
    try:
        rows = conn.execute("SELECT key, value FROM app_settings").fetchall()
        for row in rows:
            if row["value"]:
                os.environ[row["key"]] = row["value"]
    finally:
        conn.close()
