import os
import sqlite3
from pathlib import Path

# DB lives at backend/data/stocks.db
DB_PATH = Path(__file__).parent.parent.parent / "data" / "stocks.db"


def get_connection() -> sqlite3.Connection:
    """Return a sqlite3 connection with row_factory set to sqlite3.Row."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
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
                logo_id TEXT DEFAULT NULL
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
        """)
        conn.commit()

        # Migrations for existing databases
        existing_cols = {row[1] for row in conn.execute("PRAGMA table_info(youtube_mentions)").fetchall()}
        if "sentiment" not in existing_cols:
            conn.execute("ALTER TABLE youtube_mentions ADD COLUMN sentiment TEXT NOT NULL DEFAULT 'neutral'")
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
