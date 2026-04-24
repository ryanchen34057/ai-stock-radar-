"""Build backend/data/stocks_us.json from NASDAQ Trader's official symbol directory.

Sources (public, updated daily):
    https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt
    https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt

Usage:
    python scripts/build_us_stocks.py
    python scripts/build_us_stocks.py --include-etf   # also include ETFs
    python scripts/build_us_stocks.py --local /tmp/us-stocks  # use local files
"""

import argparse
import json
import sys
import urllib.request
from pathlib import Path

NASDAQ_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt"
OTHER_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt"

EXCHANGE_MAP = {
    "N": "NYSE",
    "A": "NYSE AMERICAN",
    "P": "NYSE ARCA",
    "Z": "BATS",
    "V": "IEX",
}


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


def read_source(name: str, local: Path | None, url: str) -> str:
    if local:
        p = local / name
        if p.exists():
            return p.read_text(encoding="utf-8", errors="replace")
    return fetch(url)


def clean_name(raw: str) -> str:
    """Strip common suffixes like 'Common Stock', trailing whitespace."""
    name = raw.strip()
    for tail in (
        " - Common Stock",
        " Common Stock",
        " - Ordinary Shares",
        " Ordinary Shares",
        " - American Depositary Shares",
        " American Depositary Shares",
    ):
        if name.endswith(tail):
            name = name[: -len(tail)].strip()
    return name


def parse_nasdaq(text: str, include_etf: bool) -> list[dict]:
    out = []
    lines = text.splitlines()
    if not lines:
        return out
    # Skip header and any trailing 'File Creation Time' line.
    for line in lines[1:]:
        if not line or line.startswith("File Creation Time"):
            continue
        parts = line.split("|")
        if len(parts) < 8:
            continue
        symbol, name, _cat, test_issue, _fin_status, _lot, etf, _next = parts[:8]
        if test_issue == "Y":
            continue
        if etf == "Y" and not include_etf:
            continue
        # Skip composite-style suffix symbols (rights "R", warrants "W", units "U"
        # are often 5-letter variants). Common stock is typically 1-4 letters.
        # Keep 5-letter ones too because some legit tickers are 5 chars — but
        # filter symbols containing '$' which denote preferred share classes.
        if "$" in symbol:
            continue
        out.append(
            {
                "symbol": symbol.strip(),
                "name": clean_name(name),
                "market": "US",
                "exchange": "NASDAQ",
                "is_etf": etf == "Y",
            }
        )
    return out


def parse_other(text: str, include_etf: bool) -> list[dict]:
    out = []
    lines = text.splitlines()
    if not lines:
        return out
    for line in lines[1:]:
        if not line or line.startswith("File Creation Time"):
            continue
        parts = line.split("|")
        if len(parts) < 8:
            continue
        symbol, name, exch, _cqs, etf, _lot, test_issue, _nasdaq = parts[:8]
        if test_issue == "Y":
            continue
        if etf == "Y" and not include_etf:
            continue
        if "$" in symbol:
            continue
        exchange = EXCHANGE_MAP.get(exch, exch)
        # NYSE ARCA is ETF-heavy — skip unless caller asked for ETFs.
        if exchange == "NYSE ARCA" and not include_etf:
            continue
        out.append(
            {
                "symbol": symbol.strip(),
                "name": clean_name(name),
                "market": "US",
                "exchange": exchange,
                "is_etf": etf == "Y",
            }
        )
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--include-etf", action="store_true", help="Include ETFs")
    parser.add_argument("--local", type=Path, default=None,
                        help="Directory with nasdaqlisted.txt / otherlisted.txt")
    parser.add_argument("--out", type=Path,
                        default=Path(__file__).parent.parent / "data" / "stocks_us.json")
    args = parser.parse_args()

    nasdaq_text = read_source("nasdaqlisted.txt", args.local, NASDAQ_URL)
    other_text = read_source("otherlisted.txt", args.local, OTHER_URL)

    rows = parse_nasdaq(nasdaq_text, args.include_etf) + parse_other(other_text, args.include_etf)

    # Deduplicate by symbol (prefer NASDAQ listing over others).
    seen: dict[str, dict] = {}
    for r in rows:
        if r["symbol"] not in seen:
            seen[r["symbol"]] = r
    uniq = list(seen.values())
    uniq.sort(key=lambda r: r["symbol"])

    # Final record shape (matches stocks.json conventions).
    records = []
    for r in uniq:
        records.append({
            "symbol": r["symbol"],
            "name": r["name"],
            "market": "US",
            "exchange": r["exchange"],
            "layer": 0,
            "layer_name": "",
            "sub_category": None,
            "note": "ETF" if r["is_etf"] else None,
            "theme": "A",
            "tier": 2,
            "enabled": False,  # Inert by default. User enables subsets from the UI.
        })

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")

    etf_count = sum(1 for r in records if r["note"] == "ETF")
    print(f"Wrote {len(records)} US symbols to {args.out}")
    print(f"  Non-ETF: {len(records) - etf_count}")
    print(f"  ETF: {etf_count}")


if __name__ == "__main__":
    main()
