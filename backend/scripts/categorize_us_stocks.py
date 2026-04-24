"""Categorize every US ticker in stocks_us.json by GICS sector.

Uses NASDAQ's public screener API (one bulk request per sector) instead of
yfinance's per-ticker .info endpoint. Yahoo Finance aggressively rate-limits
and 401-blocks bulk categorization; NASDAQ does not. This pulls ~6,200
categorized stocks in ~15 seconds total across 11 sector queries.

NASDAQ's sector taxonomy maps 1:1 to GICS 11 sectors (different URL slugs):
    technology              -> IT  (101)
    health_care             -> HC  (102)
    finance                 -> FN  (103)
    consumer_discretionary  -> CD  (104)
    consumer_staples        -> CS  (105)
    telecommunications      -> CM  (106)
    industrials             -> IN  (107)
    energy                  -> EN  (108)
    basic_materials         -> MT  (109)
    utilities               -> UT  (110)
    real_estate             -> RE  (111)

Usage:
    python -m scripts.categorize_us_stocks            # full run
    python -m scripts.categorize_us_stocks --summary  # print stats only
"""
from __future__ import annotations

import argparse
import json
import logging
import re
import sys
import urllib.request
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout)
logger = logging.getLogger(__name__)

DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "stocks_us.json"

# NASDAQ sector slug -> (theme_code, layer_id, layer_name_zh, gics_sector_name)
SECTOR_MAP: dict[str, tuple[str, int, str, str]] = {
    "technology":              ("IT", 101, "資訊科技",    "Technology"),
    "health_care":             ("HC", 102, "醫療保健",    "Healthcare"),
    "finance":                 ("FN", 103, "金融",        "Financial Services"),
    "consumer_discretionary":  ("CD", 104, "非必需消費",  "Consumer Cyclical"),
    "consumer_staples":        ("CS", 105, "必需消費",    "Consumer Defensive"),
    "telecommunications":      ("CM", 106, "通訊服務",    "Communication Services"),
    "industrials":             ("IN", 107, "工業",        "Industrials"),
    "energy":                  ("EN", 108, "能源",        "Energy"),
    "basic_materials":         ("MT", 109, "原物料",      "Basic Materials"),
    "utilities":               ("UT", 110, "公用事業",    "Utilities"),
    "real_estate":             ("RE", 111, "房地產",      "Real Estate"),
}

NASDAQ_URL = "https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&sector={slug}"


def fetch_sector(slug: str) -> list[dict]:
    url = NASDAQ_URL.format(slug=slug)
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())
    rows = (data.get("data") or {}).get("table", {}).get("rows") or []
    return rows


def parse_market_cap(s: str | None) -> float:
    """NASDAQ returns marketCap like '4,851,252,000,000' or '' for blank."""
    if not s:
        return 0.0
    try:
        return float(s.replace(",", ""))
    except ValueError:
        return 0.0


def load() -> list[dict]:
    return json.loads(DATA_FILE.read_text(encoding="utf-8"))


def save(records: list[dict]) -> None:
    DATA_FILE.write_text(
        json.dumps(records, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def categorize(records: list[dict]) -> None:
    by_sym = {r["symbol"]: r for r in records}

    # First pass: reset every stock's categorization state.
    for r in records:
        r["enabled"] = False
        r["layer"] = 0
        r["layer_name"] = ""
        r["sub_category"] = None
        r["sector"] = None
        r["theme"] = "A"
        r["tier"] = 2
        r["gics_categorized"] = False

    total_hit = 0
    for slug, (theme_code, layer_id, layer_name, sector_name) in SECTOR_MAP.items():
        try:
            rows = fetch_sector(slug)
        except Exception as e:
            logger.error("fetch %s failed: %s", slug, e)
            continue
        logger.info("%-24s %5d stocks", slug, len(rows))
        for row in rows:
            sym = (row.get("symbol") or "").strip()
            if not sym or sym not in by_sym:
                continue
            r = by_sym[sym]
            # First-match-wins: if NASDAQ returns the same ticker in multiple
            # sector queries (a known quirk — e.g. Visa appears in both finance
            # and real_estate buckets), keep the earliest sector assignment.
            if r.get("gics_categorized"):
                continue
            cap = parse_market_cap(row.get("marketCap"))

            # Tier by market cap: $50B+ large, $5B-$50B mid, <$5B small
            if cap >= 50_000_000_000:
                tier = 1
            elif cap >= 5_000_000_000:
                tier = 2
            else:
                tier = 3

            r.update({
                "sector": sector_name,
                "theme": theme_code,
                "layer": layer_id,
                "layer_name": layer_name,
                "sub_category": sector_name,  # placeholder; refine with yfinance industry later
                "market_cap_raw": cap,
                "tier": tier,
                "enabled": cap >= 100_000_000,  # hide sub-$100M by default
                "gics_categorized": True,
            })
            total_hit += 1

    logger.info("Categorized %d / %d stocks", total_hit, len(records))
    save(records)


def summarize(records: list[dict]) -> None:
    from collections import Counter
    total = len(records)
    categorized = sum(1 for r in records if r.get("gics_categorized"))
    enabled = sum(1 for r in records if r.get("enabled"))
    by_layer = Counter(r.get("layer_name") for r in records if r.get("enabled"))
    by_tier = Counter(r.get("tier") for r in records if r.get("enabled"))

    print(f"\nTotal: {total}")
    print(f"Categorized: {categorized}")
    print(f"Enabled (market cap >= $100M): {enabled}")
    print("\nBy sector (enabled only):")
    for sector, n in sorted(by_layer.items(), key=lambda x: -x[1]):
        name = sector if sector else "(none)"
        # safe-print for cp950 terminals
        try:
            print(f"  {name:16} {n:5}")
        except UnicodeEncodeError:
            print(f"  {name.encode('ascii','replace').decode():16} {n:5}")
    print("\nBy tier:")
    labels = {1: "Large (>=$50B)", 2: "Mid ($5B-$50B)", 3: "Small (<$5B)"}
    for tier, n in sorted(by_tier.items()):
        print(f"  Tier {tier} {labels.get(tier, str(tier)):22} {n:5}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--summary", action="store_true")
    args = ap.parse_args()

    records = load()
    if args.summary:
        summarize(records)
        return

    categorize(records)
    summarize(records)


if __name__ == "__main__":
    main()
