#!/usr/bin/env python3
"""Fetch Pixel price history from PPH and endoflife.date, compute annualized costs.

Outputs public/pixel-annualized-price/data.json

Annualized price = price * 365.25 / days_from_that_price_date_to_eol
This represents the effective cost per year if you buy at a given price
and hold the device until end-of-life.
"""

import json
import re
import urllib.request
import urllib.error
from datetime import date, datetime, timezone
from pathlib import Path

PPH_URL = "https://pixelpricehistory.mpxin.com/"
EOL_URL = "https://endoflife.date/api/pixel.json"
OUTDIR = Path("public/pixel-annualized-price")

# Map PPH slugs to endoflife.date cycle identifiers
SLUG_TO_CYCLE = {
    "pixel-9": "9",
    "pixel-9-pro": "9pro",
    "pixel-9-pro-xl": "9proxl",
    "pixel-9a": "9a",
    "pixel-10": "10",
    "pixel-10-pro": "10pro",
    "pixel-10-pro-xl": "10proxl",
    "pixel-10-pro-fold": "9profold",
    "pixel-10a": "10a",
}


def fetch_text(url: str) -> str:
    req = urllib.request.Request(url)
    req.add_header("User-Agent", "pixel-annualized/1.0")
    with urllib.request.urlopen(req) as resp:
        return resp.read().decode()


def parse_pph_products(html: str) -> list[dict]:
    """Extract product data array from Next.js RSC payload in the HTML."""
    rsc_re = re.compile(
        r'<script>self\.__next_f\.push\(\[1,"((?:\\.|[^"\\])*)"\]\)</script>',
        re.S,
    )
    chunks = []
    for m in rsc_re.finditer(html):
        try:
            chunks.append(json.loads('"' + m.group(1) + '"'))
        except json.JSONDecodeError:
            continue

    tdata_chunk = next((c for c in chunks if '"tData":[' in c), None)
    if not tdata_chunk:
        return []

    prefix = '"tData":'
    start_pos = tdata_chunk.index(prefix + "[") + len(prefix)

    # Bracket-match to find matching closing bracket
    depth = 0
    in_str = False
    esc = False
    end_pos = start_pos
    for i in range(start_pos, len(tdata_chunk)):
        ch = tdata_chunk[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        else:
            if ch == '"':
                in_str = True
            elif ch == "[":
                depth += 1
            elif ch == "]":
                depth -= 1
                if depth == 0:
                    end_pos = i + 1
                    break

    return json.loads(tdata_chunk[start_pos:end_pos])


def parse_pph_date(d: str) -> date:
    """Parse DD/MM/YY or D/M/YY date string."""
    parts = d.split("/")
    if len(parts) != 3:
        raise ValueError(f"Cannot parse date: {d}")
    day, month, year = int(parts[0]), int(parts[1]), int(parts[2])
    if year < 100:
        year += 2000
    return date(year, month, day)


def main() -> None:
    print("Fetching Pixel price history page...")
    html = fetch_text(PPH_URL)

    print("Parsing products...")
    products = parse_pph_products(html)
    print(f"  Found {len(products)} products")

    print("Fetching endoflife.date API...")
    eol_raw = fetch_text(EOL_URL)
    eol_data = json.loads(eol_raw)
    eol_map: dict[str, dict] = {item["cycle"]: item for item in eol_data}
    print(f"  Found {len(eol_data)} endoflife entries")

    today = date.today()
    models: list[dict] = []
    pph_slugs: set[str] = set()

    for p in products:
        slug = p.get("slug", "")
        pph_slugs.add(slug)
        cycle = SLUG_TO_CYCLE.get(slug)
        if not cycle or cycle not in eol_map:
            continue

        eol_item = eol_map[cycle]
        eol_date = date.fromisoformat(eol_item["eol"])
        release_date = date.fromisoformat(eol_item["releaseDate"])
        total_days = max(1, (eol_date - release_date).days)

        crnt_price = p.get("crntPrice", 0)
        price_history = p.get("priceHistory", [])

        # Parse and enrich each price-history point with annualized cost
        parsed_history: list[dict] = []
        for ph in price_history:
            try:
                ph_date = parse_pph_date(ph["date"])
                price = ph["price"]
                days_to_eol = max(1, (eol_date - ph_date).days)
                annualized = round(price * 365.25 / days_to_eol, 2)
                parsed_history.append(
                    {
                        "date": ph_date.isoformat(),
                        "price": price,
                        "promotion": ph.get("promotion", ""),
                        "daysToEol": days_to_eol,
                        "annualizedPrice": annualized,
                    }
                )
            except (ValueError, KeyError):
                continue

        parsed_history.sort(key=lambda x: x["date"])

        launch_price = parsed_history[0]["price"] if parsed_history else 0
        launch_annualized = (
            round(launch_price * 365.25 / total_days, 2) if launch_price else 0
        )

        days_now_to_eol = max(1, (eol_date - today).days)
        current_annualized = (
            round(crnt_price * 365.25 / days_now_to_eol, 2) if crnt_price else 0
        )

        models.append(
            {
                "label": eol_item["releaseLabel"],
                "slug": slug,
                "releaseDate": release_date.isoformat(),
                "eol": eol_date.isoformat(),
                "totalDays": total_days,
                "daysRemaining": days_now_to_eol,
                "hasPriceData": True,
                "launchPrice": launch_price,
                "launchAnnualizedPrice": launch_annualized,
                "crntPrice": crnt_price,
                "crntAnnualizedPrice": current_annualized,
                "priceHistory": parsed_history,
            }
        )

    # Include endoflife-only models (no PPH data)
    for cycle, item in eol_map.items():
        slug = next((s for s, c in SLUG_TO_CYCLE.items() if c == cycle), None)
        if slug and slug in pph_slugs:
            continue

        eol_date = date.fromisoformat(item["eol"])
        release_date = date.fromisoformat(item["releaseDate"])
        total_days = max(1, (eol_date - release_date).days)
        days_now_to_eol = max(1, (eol_date - today).days)

        models.append(
            {
                "label": item["releaseLabel"],
                "slug": slug or f"pixel-{cycle}",
                "releaseDate": release_date.isoformat(),
                "eol": eol_date.isoformat(),
                "totalDays": total_days,
                "daysRemaining": days_now_to_eol,
                "hasPriceData": False,
                "launchPrice": None,
                "launchAnnualizedPrice": None,
                "crntPrice": None,
                "crntAnnualizedPrice": None,
                "priceHistory": [],
            }
        )

    models.sort(key=lambda m: m["releaseDate"], reverse=True)

    output = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "models": models,
    }

    OUTDIR.mkdir(parents=True, exist_ok=True)
    outpath = OUTDIR / "data.json"
    outpath.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    print(f"\nSaved to {outpath}")
    print(f"  Total models: {len(models)}")

    with_price = [m for m in models if m.get("hasPriceData")]
    print(f"  With price data: {len(with_price)}")
    for m in with_price:
        print(
            f"    {m['label']}: launch=${m['launchPrice']} "
            f"({m['launchAnnualizedPrice']}/yr), "
            f"current=${m['crntPrice']} ({m['crntAnnualizedPrice']}/yr)"
        )


if __name__ == "__main__":
    main()
