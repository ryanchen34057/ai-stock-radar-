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
                note TEXT
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
    finally:
        conn.close()
