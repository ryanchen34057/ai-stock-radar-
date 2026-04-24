"""
News service: MOPS announcements + Google News RSS + static external links.
Cache: SQLite news_cache table, TTL = 6 hours.
"""
import json
import logging
import random
import time
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta

import requests
import urllib3
from bs4 import BeautifulSoup

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
logger = logging.getLogger(__name__)

BLACKLIST = [
    "CMoney研究員", "AI研究員", "智能分析", "快訊",
    "發大財", "飆股", "噴出",
    "股市爆料同學會", "股市報料同學會",
]

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
]

CACHE_TTL_HOURS = 6


def _ua() -> dict:
    return {"User-Agent": random.choice(USER_AGENTS)}


def _blacklisted(title: str, source: str = "") -> bool:
    return any(kw in title + source for kw in BLACKLIST)


def _within_7d(date_str: str) -> bool:
    try:
        d = datetime.strptime(date_str, "%Y-%m-%d")
        return (datetime.now() - d).days <= 7
    except Exception:
        return True  # keep if unparseable


def _parse_roc_date(raw: str) -> str:
    """Convert MOPS date strings to YYYY-MM-DD.
    Handles: '115/04/17', '114/4/7', '2026/04/17', '20260417'
    """
    raw = raw.strip()
    try:
        if "/" in raw:
            parts = raw.split("/")
            y = int(parts[0])
            m = int(parts[1])
            d = int(parts[2]) if len(parts) > 2 else 1
            if y < 1911:
                y += 1911
            return f"{y:04d}-{m:02d}-{d:02d}"
        elif len(raw) == 8 and raw.isdigit():
            return f"{raw[:4]}-{raw[4:6]}-{raw[6:8]}"
    except Exception:
        pass
    return ""


# ── MOPS announcements ────────────────────────────────────────────────────────

def _fetch_mops(symbol: str) -> list[dict]:
    session = requests.Session()
    base_headers = _ua()

    # Warm up session cookie by visiting the main page first
    try:
        session.get(
            "https://mops.twse.com.tw/mops/web/t05st01",
            headers=base_headers, timeout=10, verify=False,
        )
    except Exception:
        pass

    url = "https://mops.twse.com.tw/mops/web/ajax_t05st01"
    headers = {
        **base_headers,
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": "https://mops.twse.com.tw/mops/web/t05st01",
        "X-Requested-With": "XMLHttpRequest",
    }
    payload = {
        "encno": symbol,
        "step": "1",
        "firstin": "1",
        "off": "1",
        "queryName": "co_id",
        "inpuType": "co_id",
        "TYPEK": "all",
        "isnew": "false",
    }
    try:
        r = session.post(url, data=payload, headers=headers, timeout=12, verify=False)
        r.encoding = "utf-8"
        soup = BeautifulSoup(r.text, "html.parser")

        results = []
        for tr in soup.select("table tr"):
            cells = tr.find_all("td")
            if len(cells) < 4:
                continue

            # Typical columns: 序號, 發言日期, 發言時間, 主旨, ...
            date_raw = cells[1].get_text(strip=True)
            title_cell = cells[3]
            title = title_cell.get_text(strip=True)
            a_tag = title_cell.find("a")
            href = a_tag["href"] if a_tag and a_tag.get("href") else ""

            date_str = _parse_roc_date(date_raw)
            if not date_str or not title:
                continue
            if not _within_7d(date_str):
                continue
            if _blacklisted(title):
                continue

            if href and not href.startswith("http"):
                href = "https://mops.twse.com.tw" + href

            results.append({"date": date_str, "title": title, "url": href})

        return results[:20]

    except Exception as e:
        logger.warning(f"MOPS fetch error ({symbol}): {e}")
        return []


# ── Google News RSS ───────────────────────────────────────────────────────────

def _fetch_google_news(symbol: str, name: str) -> list[dict]:
    query = urllib.parse.quote(f"{name} {symbol}")
    url = f"https://news.google.com/rss/search?q={query}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant"
    try:
        r = requests.get(url, headers=_ua(), timeout=12, verify=False)
        r.encoding = "utf-8"
        root = ET.fromstring(r.content)

        results = []
        for item in root.findall(".//item"):
            def _text(tag: str) -> str:
                el = item.find(tag)
                return el.text.strip() if el is not None and el.text else ""

            title = _text("title")
            link = _text("link")
            pub_date = _text("pubDate")
            source_el = item.find("source")
            source = source_el.text.strip() if source_el is not None and source_el.text else ""

            if not title:
                continue
            if _blacklisted(title, source):
                continue

            date_str = ""
            if pub_date:
                for fmt in ("%a, %d %b %Y %H:%M:%S %Z", "%a, %d %b %Y %H:%M:%S %z"):
                    try:
                        date_str = datetime.strptime(pub_date, fmt).strftime("%Y-%m-%d")
                        break
                    except ValueError:
                        pass

            if date_str and not _within_7d(date_str):
                continue

            results.append({"date": date_str, "title": title, "source": source, "url": link})
            if len(results) >= 15:
                break

        return results

    except Exception as e:
        logger.warning(f"Google News RSS error ({symbol}): {e}")
        return []


# ── External links ────────────────────────────────────────────────────────────

# ── Capacity analysis ─────────────────────────────────────────────────────────

# Keywords used to surface capacity-related items from already-cached MOPS +
# news data. Taiwanese filings use both 繁體 variants and 半形 / 全形 mixes.
CAPACITY_KEYWORDS = [
    "產能", "產線", "擴產", "增產", "月產能", "年產能", "產能利用率",
    "稼動率", "新廠", "廠房", "新廠區", "量產", "試產", "投產", "動土",
    "竣工", "機台", "設備採購", "資本支出", "CapEx", "擴建",
    "法說會", "法人說明會", "年報",
]


def _contains_capacity_kw(text: str) -> str | None:
    """Return the first matched capacity keyword, or None."""
    for kw in CAPACITY_KEYWORDS:
        if kw in text:
            return kw
    return None


def get_capacity_analysis(symbol: str, name: str, conn) -> dict:
    """
    Build a capacity-analysis bundle for a single stock:
    - capacity_mops: MOPS announcements whose title mentions capacity keywords
    - capacity_news: Google News items with capacity keywords
    - primary_sources: direct links to authoritative sources (法說會, 年報, IR)

    Reads from the existing news_cache table — does not hit the network here,
    so it's instant. The caches are already populated by `refresh_all_news`.
    """
    cache = conn.execute(
        "SELECT mops_json, news_json FROM news_cache WHERE symbol = ?",
        (symbol,),
    ).fetchone()
    mops: list[dict] = []
    news: list[dict] = []
    if cache:
        try:
            mops = json.loads(cache["mops_json"] or "[]")
        except Exception:
            mops = []
        try:
            news = json.loads(cache["news_json"] or "[]")
        except Exception:
            news = []

    capacity_mops = []
    for m in mops:
        kw = _contains_capacity_kw(m.get("title", ""))
        if kw:
            capacity_mops.append({**m, "matched_keyword": kw})

    capacity_news = []
    for n in news:
        kw = _contains_capacity_kw(n.get("title", ""))
        if kw:
            capacity_news.append({**n, "matched_keyword": kw})

    primary_sources = _capacity_primary_sources(symbol, name)

    return {
        "capacity_mops": capacity_mops,
        "capacity_news": capacity_news,
        "primary_sources": primary_sources,
    }


def _capacity_primary_sources(symbol: str, name: str) -> list[dict]:
    """
    Links to the four authoritative channels for Taiwan-stock capacity info:
    法說會 (投資人說明會) | 年報 | YouTube 法說會 | 鉅亨/Goodinfo 產業資訊
    """
    enc_name = urllib.parse.quote(name)
    yt_query = urllib.parse.quote(f"{name} 法說會")
    gn_capacity = urllib.parse.quote(f"{name} {symbol} 產能")
    return [
        {
            "category": "法說會",
            "name": "MOPS 法說會資訊",
            "desc": "發言 / 簡報 PDF / 影音連結",
            "url": f"https://mops.twse.com.tw/mops/web/t100sb02_1?step=1&TYPEK=sii&CO_ID={symbol}",
        },
        {
            "category": "法說會",
            "name": "YouTube 法說會搜尋",
            "desc": "公司自行上傳或券商直播",
            "url": f"https://www.youtube.com/results?search_query={yt_query}",
        },
        {
            "category": "年報",
            "name": "MOPS 年報 / 財報",
            "desc": "營運概況章節含各廠區月產能",
            "url": f"https://mops.twse.com.tw/mops/web/t57sb01_q1?step=1&TYPEK=sii&CO_ID={symbol}",
        },
        {
            "category": "年報",
            "name": "MOPS 重大訊息總覽",
            "desc": "新廠動土 / 量產 / 重大資本支出",
            "url": f"https://mops.twse.com.tw/mops/web/t05st01?firstin=1&TYPEK=all&encno={symbol}&step=1",
        },
        {
            "category": "產業研究",
            "name": "鉅亨網 個股頁",
            "desc": "新聞匯整 + 分析師報告摘要",
            "url": f"https://www.cnyes.com/twstock/{symbol}",
        },
        {
            "category": "產業研究",
            "name": "Goodinfo 經營績效",
            "desc": "毛利率 / 產能利用率趨勢",
            "url": f"https://goodinfo.tw/tw/StockBzPerformance.asp?STOCK_ID={symbol}",
        },
        {
            "category": "產業研究",
            "name": "Google News 產能搜尋",
            "desc": f"關鍵字：{name} 產能",
            "url": f"https://news.google.com/search?q={gn_capacity}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
        },
        {
            "category": "產業研究",
            "name": "MoneyDJ 個股新聞",
            "desc": "法人觀點整理",
            "url": f"https://www.moneydj.com/kmdj/search/default.aspx?_Query_={enc_name}",
        },
    ]


def _external_links(symbol: str, name: str) -> list[dict]:
    gq = urllib.parse.quote(f"{name} {symbol} 股票")
    return [
        {"name": "公開資訊觀測站",   "url": f"https://mops.twse.com.tw/mops/web/t05st01?firstin=1&TYPEK=all&encno={symbol}&step=1"},
        {"name": "鉅亨網",          "url": f"https://www.cnyes.com/twstock/{symbol}"},
        {"name": "Goodinfo",        "url": f"https://goodinfo.tw/tw/StockDetail.asp?STOCK_ID={symbol}"},
        {"name": "Google News 搜尋", "url": f"https://news.google.com/search?q={gq}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant"},
    ]


# ── Public interface ──────────────────────────────────────────────────────────

def refresh_one_stalest(conn, market: str | None = None) -> dict:
    """
    Scrape MOPS + Google News for the single stock whose cache is oldest
    (or missing entirely). Returns the refreshed stock's metadata.

    This is the per-poll refresh unit used by the frontend's trickle feed —
    gentle on external sources and always brings one fresh batch each tick.

    Pass market='TW'|'US' to restrict the trickle to a single market.
    """
    # Prefer stocks with NO cache row at all, then the oldest cached one.
    if market:
        row = conn.execute(
            """SELECT s.symbol, s.name, c.fetched_at
               FROM stocks s
               LEFT JOIN news_cache c ON s.symbol = c.symbol
               WHERE s.enabled = 1 AND s.market = ?
               ORDER BY (c.fetched_at IS NULL) DESC, c.fetched_at ASC
               LIMIT 1""",
            (market.upper(),),
        ).fetchone()
    else:
        row = conn.execute(
            """SELECT s.symbol, s.name, c.fetched_at
               FROM stocks s
               LEFT JOIN news_cache c ON s.symbol = c.symbol
               WHERE s.enabled = 1
               ORDER BY (c.fetched_at IS NULL) DESC, c.fetched_at ASC
               LIMIT 1"""
        ).fetchone()
    if not row:
        return {"status": "empty"}

    symbol = row["symbol"]
    name = row["name"]
    prev = row["fetched_at"]

    try:
        mops = _fetch_mops(symbol)
        time.sleep(random.uniform(0.4, 0.9))
        gnews = _fetch_google_news(symbol, name)
        conn.execute(
            """INSERT OR REPLACE INTO news_cache (symbol, fetched_at, mops_json, news_json)
               VALUES (?, ?, ?, ?)""",
            (symbol, datetime.now().isoformat(), json.dumps(mops), json.dumps(gnews)),
        )
        conn.commit()
        logger.info(f"refresh_one_stalest: {symbol} {name} (prev={prev}) mops={len(mops)} news={len(gnews)}")
        return {
            "status": "ok",
            "symbol": symbol,
            "name": name,
            "prev_fetched_at": prev,
            "mops_count": len(mops),
            "news_count": len(gnews),
        }
    except Exception as e:
        logger.warning(f"refresh_one_stalest {symbol}: {e}")
        return {"status": "error", "symbol": symbol, "error": str(e)}


def refresh_all_news(conn, skip_fresh_hours: int = 6, sleep_between: float = 1.0):
    """
    Fetch Google News for every stock that has no news cache or stale cache.
    Intended for background execution — polite delay between requests.
    """
    stocks = conn.execute("SELECT symbol, name FROM stocks").fetchall()
    refreshed = 0
    skipped = 0
    for row in stocks:
        sym, name = row["symbol"], row["name"]
        cache = conn.execute(
            "SELECT fetched_at FROM news_cache WHERE symbol = ?", (sym,)
        ).fetchone()
        if cache:
            age = (datetime.now() - datetime.fromisoformat(cache["fetched_at"])).total_seconds() / 3600
            if age < skip_fresh_hours:
                skipped += 1
                continue
        try:
            mops = _fetch_mops(sym)
            time.sleep(random.uniform(0.3, 0.8))
            gnews = _fetch_google_news(sym, name)
            conn.execute(
                """INSERT OR REPLACE INTO news_cache (symbol, fetched_at, mops_json, news_json)
                   VALUES (?, ?, ?, ?)""",
                (sym, datetime.now().isoformat(), json.dumps(mops), json.dumps(gnews)),
            )
            conn.commit()
            refreshed += 1
            logger.info(f"refresh_all_news: {sym} {name} ({refreshed} done)")
        except Exception as e:
            logger.warning(f"refresh_all_news {sym}: {e}")
        time.sleep(sleep_between)
    logger.info(f"refresh_all_news: refreshed {refreshed}, skipped {skipped}")
    return {"refreshed": refreshed, "skipped": skipped}


def get_aggregated_feed(conn, limit: int = 150, market: str | None = None) -> list[dict]:
    """
    Aggregate all cached news into a single feed sorted by date desc.
    Each item includes the stock symbol + name for context.
    Pass market='TW' or 'US' to scope the feed to one market.
    """
    if market:
        rows = conn.execute(
            "SELECT s.symbol, s.name, s.sub_category, s.note, s.layer_name, s.tier, "
            "c.news_json FROM news_cache c "
            "JOIN stocks s ON s.symbol = c.symbol "
            "WHERE s.enabled = 1 AND s.market = ?",
            (market.upper(),),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT s.symbol, s.name, s.sub_category, s.note, s.layer_name, s.tier, "
            "c.news_json FROM news_cache c "
            "JOIN stocks s ON s.symbol = c.symbol WHERE s.enabled = 1"
        ).fetchall()

    items: list[dict] = []
    seen_urls: set[str] = set()
    for row in rows:
        try:
            news_list = json.loads(row["news_json"] or "[]")
        except Exception:
            continue
        for n in news_list:
            url = n.get("url", "")
            if url and url in seen_urls:
                continue
            seen_urls.add(url)
            items.append({
                "stock_symbol": row["symbol"],
                "stock_name": row["name"],
                "sub_category": row["sub_category"],
                "layer_name": row["layer_name"],
                "note": row["note"],
                "tier": row["tier"] if "tier" in row.keys() else None,
                "date": n.get("date", ""),
                "title": n.get("title", ""),
                "source": n.get("source", ""),
                "url": url,
            })

    items.sort(key=lambda x: x["date"], reverse=True)
    return items[:limit]


def get_news(symbol: str, name: str, conn) -> dict:
    """Return news dict, reading from DB cache if fresh enough."""
    row = conn.execute(
        "SELECT fetched_at, mops_json, news_json FROM news_cache WHERE symbol = ?",
        (symbol,),
    ).fetchone()

    if row:
        age = (datetime.now() - datetime.fromisoformat(row["fetched_at"])).total_seconds() / 3600
        if age < CACHE_TTL_HOURS:
            return {
                "mops_announcements": json.loads(row["mops_json"]),
                "news": json.loads(row["news_json"]),
                "external_links": _external_links(symbol, name),
            }

    logger.info(f"Fetching fresh news: {symbol} ({name})")
    mops = _fetch_mops(symbol)
    time.sleep(random.uniform(0.5, 1.5))
    gnews = _fetch_google_news(symbol, name)

    conn.execute(
        """INSERT OR REPLACE INTO news_cache (symbol, fetched_at, mops_json, news_json)
           VALUES (?, ?, ?, ?)""",
        (symbol, datetime.now().isoformat(), json.dumps(mops), json.dumps(gnews)),
    )
    conn.commit()

    return {
        "mops_announcements": mops,
        "news": gnews,
        "external_links": _external_links(symbol, name),
    }
