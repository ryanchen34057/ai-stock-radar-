"""Pull every common-share TW stock from TWSE's ISIN endpoint and merge
them into backend/data/stocks.json under a new theme "D" (全市場), so the
dashboard isn't limited to the hand-curated A/B/C themes.

Behaviour:
- Existing entries (any theme) are kept as-is. Symbols already curated
  under A/B/C don't get demoted to D.
- New symbols are added with theme="D", layer=30, layer_name="全市場",
  sub_category=產業別 from TWSE, tier=3 so they're filtered out unless
  the user opts in via tierFilter=全部.
- Only common stocks (CFI starting with ES) are kept — drops warrants,
  ETFs, REITs, futures, etc.

Run:
    python -m scripts.build_tw_full
"""
from __future__ import annotations

import json
import warnings
from pathlib import Path

import requests
from bs4 import BeautifulSoup
from urllib3.exceptions import InsecureRequestWarning

ISIN_URL = "https://isin.twse.com.tw/isin/C_public.jsp"
DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "stocks.json"

# strMode → human label, used only in console output
MARKETS = {
    "2": "上市",
    "4": "上櫃",
}

# Theme D layer info — kept compact so the frontend only needs to learn
# one new layer ID for the entire 全市場 dump.
THEME_D = "D"
LAYER_D = 30
LAYER_NAME_D = "全市場"


def fetch_market(str_mode: str) -> list[dict]:
    """Fetch the ISIN listing for one market and return parsed rows.

    `verify=False`: TWSE's cert is missing the Subject Key Identifier
    extension, which Python 3.14+ rejects. The site is a public read-only
    government endpoint serving public stock metadata, so MITM risk on
    the contents is moot. The matching urllib3 warning is silenced.

    Each returned dict has: symbol, name, industry.
    """
    warnings.simplefilter("ignore", InsecureRequestWarning)
    resp = requests.get(
        ISIN_URL, params={"strMode": str_mode}, timeout=30, verify=False,
    )
    resp.encoding = "big5"

    soup = BeautifulSoup(resp.text, "html.parser")
    # The page has a layout-wrapper <table> at the top with 0 rows; the
    # actual data lives in a deeper <table>. Pick whichever has the most
    # rows so we don't depend on its exact position.
    tables = soup.find_all("table")
    table = max(tables, key=lambda t: len(t.find_all("tr")), default=None)
    if table is None or not table.find_all("tr"):
        raise RuntimeError(f"strMode={str_mode}: no data table in ISIN page")

    rows = table.find_all("tr")
    # First row is the header — find column indices by name so we don't
    # break if TWSE re-orders columns.
    header_cells = [c.get_text(strip=True) for c in rows[0].find_all(["th", "td"])]
    def col_idx(needle: str) -> int:
        for i, h in enumerate(header_cells):
            if needle in h:
                return i
        return -1
    code_i = col_idx("代號")          # combined "代號及名稱"
    industry_i = col_idx("產業")
    cfi_i = col_idx("CFI")

    out: list[dict] = []
    for tr in rows[1:]:
        cells = [c.get_text(strip=True) for c in tr.find_all(["th", "td"])]
        if len(cells) < max(code_i, cfi_i) + 1:
            continue
        cfi = cells[cfi_i] if cfi_i >= 0 else ""
        # ES = Equity / common Share — drops warrants (RW), REITs (RU),
        # ETFs (CE), etc.
        if not cfi.startswith("ES"):
            continue
        symbol, name = split_code_name(cells[code_i])
        if not symbol or not name:
            continue
        industry = cells[industry_i].strip() if industry_i >= 0 else ""
        out.append({"symbol": symbol, "name": name, "industry": industry or "其他"})
    return out


def split_code_name(s: str) -> tuple[str, str]:
    """ISIN's combined column is '2330　台積電' (ideographic space)."""
    s = str(s).strip()
    parts = s.replace("　", " ").split()
    if len(parts) >= 2:
        return parts[0], " ".join(parts[1:])
    return s, ""


def main() -> None:
    with open(DATA_PATH, encoding="utf-8") as f:
        existing = json.load(f)
    by_symbol = {s["symbol"]: s for s in existing}
    print(f"loaded {len(existing)} existing stocks from {DATA_PATH.name}")

    added = 0
    for str_mode, label in MARKETS.items():
        print(f"fetching ISIN strMode={str_mode} ({label})…")
        rows = fetch_market(str_mode)
        print(f"  → {len(rows)} common-share rows")

        for r in rows:
            symbol = r["symbol"]
            if symbol in by_symbol:
                continue   # don't touch curated entries
            by_symbol[symbol] = {
                "symbol": symbol,
                "name": r["name"],
                "layer": LAYER_D,
                "layer_name": LAYER_NAME_D,
                "sub_category": r["industry"],
                "note": "",
                "theme": THEME_D,
                "tier": 3,
                "enabled": True,
            }
            added += 1

    # Sort: existing curated entries first (in their original order), then
    # new theme-D entries by symbol so diffs stay readable.
    curated_order = [s["symbol"] for s in existing]
    in_curated = set(curated_order)
    new_symbols = sorted(s for s in by_symbol if s not in in_curated)

    out = ([by_symbol[s] for s in curated_order]
           + [by_symbol[s] for s in new_symbols])

    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"added {added} new stocks under theme D / layer {LAYER_D}")
    print(f"total now: {len(out)} (curated {len(existing)} + new {added})")


if __name__ == "__main__":
    main()
