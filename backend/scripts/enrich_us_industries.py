"""Second-pass enrichment: fetch NASDAQ industry for every enabled US stock.

After scripts/categorize_us_stocks.py runs, every stock has its GICS sector
(layer 101-111) but sub_category is just a duplicate of layer_name — so all
~540 Tech stocks group into one giant block on the dashboard.

This script hits NASDAQ's per-symbol summary endpoint, which returns a
granular industry string like "Semiconductors" / "Major Banks" / "Biotech-
nology: Pharmaceutical Preparations". We store that in sub_category so the
dashboard groups each sector by finer industry buckets (same UX Taiwan has
via sub_category).

~4,268 calls × 10 workers ≈ 4 min. NASDAQ's per-stock endpoint has not rate-
limited us so far. Resumable: skips stocks that already have sub_category
set to something other than the sector name.

Usage:
    python -m scripts.enrich_us_industries                  # enriches enabled stocks
    python -m scripts.enrich_us_industries --workers 15     # more parallelism
    python -m scripts.enrich_us_industries --all            # also sub-$100M stocks
    python -m scripts.enrich_us_industries --force          # redo even if already enriched
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout)
logger = logging.getLogger(__name__)

DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "stocks_us.json"
SUMMARY_URL = "https://api.nasdaq.com/api/quote/{sym}/summary?assetclass=stocks"


def fetch_industry(symbol: str) -> str | None:
    # NASDAQ uses "/" in some ticker variants (e.g. BRK/B); URL-encode safely.
    safe = symbol.replace("/", ".").replace("$", "")
    try:
        req = urllib.request.Request(
            SUMMARY_URL.format(sym=safe),
            headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
        summary = (data.get("data") or {}).get("summaryData") or {}
        ind = (summary.get("Industry") or {}).get("value")
        return ind.strip() if ind else None
    except Exception as e:
        logger.debug("industry fail %s: %s", symbol, e)
        return None


def load() -> list[dict]:
    return json.loads(DATA_FILE.read_text(encoding="utf-8"))


def save(records: list[dict]) -> None:
    DATA_FILE.write_text(
        json.dumps(records, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def enrich(records: list[dict], workers: int, include_disabled: bool, force: bool) -> None:
    def needs_fetch(r: dict) -> bool:
        if not r.get("gics_categorized"):
            return False
        if not include_disabled and not r.get("enabled"):
            return False
        if force:
            return True
        # Skip if sub_category is already finer-grained than layer_name.
        sub = (r.get("sub_category") or "").strip()
        layer_name = (r.get("layer_name") or "").strip()
        sector = (r.get("sector") or "").strip()
        return not sub or sub == layer_name or sub == sector

    todo = [r for r in records if needs_fetch(r)]
    logger.info("Enriching %d of %d stocks (workers=%d)", len(todo), len(records), workers)

    done = 0
    last_save = time.time()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = {pool.submit(fetch_industry, r["symbol"]): r for r in todo}
        for fut in as_completed(futs):
            r = futs[fut]
            ind = fut.result()
            if ind:
                r["industry"] = ind
                r["sub_category"] = ind
            done += 1
            if done % 200 == 0 or time.time() - last_save > 30:
                save(records)
                last_save = time.time()
                logger.info("[%d/%d] progress saved", done, len(todo))

    save(records)
    logger.info("Done. Enriched %d stocks.", done)


def summarize(records: list[dict]) -> None:
    from collections import Counter
    by_industry = Counter(
        r.get("sub_category") for r in records
        if r.get("enabled") and r.get("sub_category") and r.get("sub_category") != r.get("layer_name")
    )
    total_enriched = sum(1 for r in records if r.get("enabled") and r.get("industry"))
    print(f"\nEnriched (enabled w/ industry): {total_enriched}")
    print(f"Distinct industries: {len(by_industry)}")
    print("\nTop 25 industries:")
    for ind, n in by_industry.most_common(25):
        try:
            print(f"  {ind[:48]:48}  {n}")
        except UnicodeEncodeError:
            print(f"  {ind.encode('ascii','replace').decode()[:48]:48}  {n}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=10)
    ap.add_argument("--all", action="store_true", help="Include disabled (sub-$100M) stocks too")
    ap.add_argument("--force", action="store_true", help="Re-fetch even if already enriched")
    ap.add_argument("--summary", action="store_true", help="Print stats only; no fetching")
    args = ap.parse_args()

    records = load()
    if args.summary:
        summarize(records)
        return

    try:
        enrich(records, args.workers, include_disabled=args.all, force=args.force)
    except KeyboardInterrupt:
        logger.warning("Interrupted — saving progress.")
        save(records)

    summarize(records)


if __name__ == "__main__":
    main()
