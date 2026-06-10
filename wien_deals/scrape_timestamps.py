#!/usr/bin/env python3
"""Wien Deals Combined - public web deal discovery.

This workflow used to print Instagram timestamps without writing any deal JSON.
It now scans Vienna-focused public web sources and writes pending deal files that
can enter the normal FreeFinder approval pipeline.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup


ROOT = Path(__file__).resolve().parents[1]
DOCS_DIR = ROOT / "docs"
OUTPUT_PATH = DOCS_DIR / "deals-pending-wien-combined.json"
EVENTS_PATH = DOCS_DIR / "deals-pending-events.json"
GEMEINDE_PATH = DOCS_DIR / "deals-pending-gemeinde.json"
GOTTESDIENSTE_PATH = DOCS_DIR / "deals-pending-gottesdienste.json"
REPORT_PATH = DOCS_DIR / "wien-deals-combined-report.json"

NOW = datetime.now(timezone.utc)
TODAY = NOW.date()
CURRENT_YEAR = TODAY.year
MAX_DEALS = max(1, int(os.getenv("WIEN_DEALS_COMBINED_MAX_DEALS", "80")))
REQUEST_TIMEOUT = max(3, int(os.getenv("WIEN_DEALS_COMBINED_TIMEOUT", "18")))


@dataclass(frozen=True)
class Source:
    name: str
    url: str
    category: str
    evergreen: bool = False


SOURCES = [
    Source("Stadt Wien Veranstaltungen", "https://www.wien.gv.at/veranstaltungen/", "kultur"),
    Source("Stadt Wien Kultur & Freizeit", "https://www.wien.gv.at/kultur-freizeit/", "kultur", True),
    Source("Buechereien Wien", "https://buechereien.wien.gv.at/B%C3%BCchereien-Wien/Veranstaltungen", "bildung"),
    Source("MuseumsQuartier Programm", "https://www.mqw.at/programm/", "kultur"),
    Source("Wien Museum Besuch", "https://www.wienmuseum.at/besuch", "kultur", True),
    Source("MeinBezirk Wien Freizeit", "https://www.meinbezirk.at/wien/c-freizeit", "kultur"),
]

DEAL_PATTERNS = [
    r"\bgratis\b",
    r"\bkostenlos(?:e|er|es|en)?\b",
    r"\bfree\b",
    r"\beintritt\s+frei\b",
    r"\bfreier\s+eintritt\b",
    r"\b0\s*(?:€|euro|eur)\b",
    r"\b1\s*\+\s*1\b",
    r"\b2\s*(?:für|fuer)\s*1\b",
    r"\b(?:rabatt|gutschein|coupon|voucher|aktion|deal|special|happy hour)\b",
]

FALSE_POSITIVE_PATTERNS = [
    r"\bgratis\s+versand\b",
    r"\bkostenlose\s+lieferung\b",
    r"\bfree\s+shipping\b",
    r"\bgewinnspiel\b",
    r"\bgewinn\b",
    r"\bgewinne\b",
    r"\bverlosung\b",
    r"\bzu\s+gewinnen\b",
    r"\bjob\b",
    r"\bwohnung\b",
    r"\bhotel\b",
    r"\bnewsletter\b",
    r"\bdatenschutz\b",
    r"\bimpressum\b",
    r"\bcookie\b",
    r"\babo\b",
]

PHOTO_CREDIT_PATTERN = re.compile(r"^(?:©|foto:|photo:|bild:)|\bfoto:\b", re.IGNORECASE)

CONFLICT_LOCATION_PATTERNS = [
    r"\bgraz\b",
    r"\blinz\b",
    r"\bsalzburg\b",
    r"\binnsbruck\b",
    r"\bklagenfurt\b",
    r"\btirol\b",
    r"\bvorarlberg\b",
    r"\bkärnten\b",
    r"\bkaernten\b",
]


def clean_text(value: str, limit: int = 800) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def normalize_ascii(value: str) -> str:
    return (
        clean_text(value, 2000)
        .lower()
        .replace("ä", "ae")
        .replace("ö", "oe")
        .replace("ü", "ue")
        .replace("ß", "ss")
    )


def has_any(patterns: Iterable[str], value: str) -> bool:
    return any(re.search(pattern, value, re.IGNORECASE) for pattern in patterns)


def stable_id(parts: Iterable[str]) -> str:
    seed = "|".join(part for part in parts if part)
    return hashlib.sha1(seed.encode("utf-8")).hexdigest()[:12]


def fetch_html(source: Source) -> tuple[str, str | None]:
    headers = {
        "User-Agent": "FreeFinder Wien Deals Combined/2.0 (+https://github.com/ataalla24-ux/deal-finder)",
        "Accept-Language": "de-AT,de;q=0.9,en;q=0.8",
    }
    try:
        response = requests.get(source.url, headers=headers, timeout=REQUEST_TIMEOUT)
        if response.status_code >= 400:
            return "", f"HTTP {response.status_code}"
        return response.text, None
    except requests.RequestException as exc:
        return "", str(exc)[:180]


def source_domain(url: str) -> str:
    return urlparse(url).netloc.replace("www.", "")


def title_from_url(url: str) -> str:
    path = urlparse(url).path.strip("/")
    if not path:
        return "Wien-Angebot"
    part = path.split("/")[-1]
    part = re.sub(r"[-_]+", " ", part)
    return clean_text(part.title(), 120) or "Wien-Angebot"


def extract_years(text: str) -> list[int]:
    return [int(year) for year in re.findall(r"\b(20\d{2})\b", text)]


def stale_year_only(text: str) -> bool:
    years = extract_years(text)
    return bool(years) and all(year < CURRENT_YEAR for year in years)


def resolve_year(month: int, explicit_year: int | None) -> int:
    if explicit_year:
        return explicit_year
    year = CURRENT_YEAR
    candidate = date(year, month, 1)
    if candidate < TODAY.replace(day=1) - timedelta(days=62):
        return year + 1
    return year


def parse_expiry(text: str, evergreen: bool) -> tuple[str, date | None, str | None]:
    signal = clean_text(text, 1600)
    normalized = normalize_ascii(signal)

    if re.search(r"\b(?:nur\s+heute|heute\s+gratis|today\s+only)\b", normalized):
        return f"Heute, {TODAY:%d.%m.%Y}", TODAY, None
    if re.search(r"\b(?:morgen|tomorrow)\b", normalized):
        tomorrow = TODAY + timedelta(days=1)
        return f"Morgen, {tomorrow:%d.%m.%Y}", tomorrow, None
    if re.search(r"\b(?:wochenende|weekend)\b", normalized):
        days_until_sunday = (6 - TODAY.weekday()) % 7
        sunday = TODAY + timedelta(days=days_until_sunday)
        return f"Dieses Wochenende, bis {sunday:%d.%m.%Y}", sunday, None

    dates: list[date] = []
    for match in re.finditer(r"\b([0-3]?\d)[./]([01]?\d)(?:[./](20\d{2}))?\b", signal):
        day = int(match.group(1))
        month = int(match.group(2))
        if day < 1 or day > 31 or month < 1 or month > 12:
            continue
        year = resolve_year(month, int(match.group(3)) if match.group(3) else None)
        try:
            dates.append(date(year, month, day))
        except ValueError:
            continue

    iso_match = re.search(r"\b(20\d{2})-([01]\d)-([0-3]\d)\b", signal)
    if iso_match:
        try:
            dates.append(date(int(iso_match.group(1)), int(iso_match.group(2)), int(iso_match.group(3))))
        except ValueError:
            pass

    future_dates = sorted(item for item in dates if item >= TODAY)
    if future_dates:
        expiry = future_dates[-1]
        return f"Bis {expiry:%d.%m.%Y}", expiry, None

    if dates and max(dates) < TODAY:
        return "", max(dates), "expired-date"

    if evergreen:
        return "laufend / laut Quelle", None, None
    return "Siehe Quelle", None, None


def infer_type(text: str) -> str:
    normalized = normalize_ascii(text)
    if re.search(r"\b1\s*\+\s*1\b|\b2\s*(?:fuer|für)\s*1\b|\bbogo\b", normalized):
        return "bogo"
    if re.search(r"\bgratis\b|\bkostenlos|free|0\s*(?:€|euro|eur)", normalized):
        return "gratis"
    if re.search(r"\bgutschein|coupon|voucher\b", normalized):
        return "gutschein"
    return "rabatt"


def infer_logo(category: str, deal_type: str) -> str:
    if deal_type == "gratis":
        return "🎁"
    if deal_type == "bogo":
        return "1+1"
    if category == "bildung":
        return "📚"
    return "🎟️"


def quality_score(text: str, expiry: str, source: Source) -> int:
    normalized = normalize_ascii(text)
    score = 44
    if re.search(r"\bgratis\b|\bkostenlos|free|eintritt frei", normalized):
        score += 24
    if re.search(r"\b1\s*\+\s*1|2\s*(?:fuer|für)\s*1|rabatt|gutschein|aktion", normalized):
        score += 12
    if re.search(r"\bheute|morgen|wochenende|dieser woche|this week", normalized):
        score += 8
    if expiry and expiry != "Siehe Quelle":
        score += 8
    if source.evergreen:
        score -= 4
    return max(35, min(92, score))


def candidate_links(html: str, source: Source) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg"]):
        tag.decompose()

    rows = []
    for link in soup.find_all("a", href=True):
        href = clean_text(link.get("href"), 600)
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue
        url = urljoin(source.url, href)
        if not url.startswith("http"):
            continue

        title = clean_text(link.get_text(" ", strip=True), 160)
        if len(title) < 6:
            title = title_from_url(url)
        parent_text = ""
        parent = link.find_parent(["article", "li", "section", "div"])
        if parent:
            parent_text = clean_text(parent.get_text(" ", strip=True), 700)

        rows.append({
            "title": title,
            "url": url,
            "context": parent_text,
            "signal": clean_text(f"{title} {parent_text} {source.name}", 1200),
        })
    return rows


def rejection_reason(row: dict, source: Source) -> str:
    signal = row["signal"]
    normalized = normalize_ascii(signal)
    if stale_year_only(signal):
        return "stale-year"
    if PHOTO_CREDIT_PATTERN.search(clean_text(row["title"], 160)) and not has_any(DEAL_PATTERNS, normalize_ascii(row["title"])):
        return "photo-credit"
    if has_any(FALSE_POSITIVE_PATTERNS, normalized):
        return "false-positive"
    if has_any(CONFLICT_LOCATION_PATTERNS, normalized):
        return "conflict-location"
    if not source.evergreen and not has_any(DEAL_PATTERNS, normalized):
        return "no-deal-signal"
    if source.evergreen and not (has_any(DEAL_PATTERNS, normalized) or "gratis" in normalize_ascii(source.name)):
        return "no-evergreen-deal-signal"
    if len(clean_text(row["title"])) < 6:
        return "weak-title"
    return ""


def build_deal(row: dict, source: Source) -> tuple[dict | None, str]:
    reason = rejection_reason(row, source)
    if reason:
        return None, reason

    expires, expiry_date, expiry_error = parse_expiry(row["signal"], source.evergreen)
    if expiry_error:
        return None, expiry_error

    deal_type = infer_type(row["signal"])
    title = clean_text(row["title"], 110)
    if title.lower() in {"mehr", "weiterlesen", "details", "programm", "veranstaltungen"}:
        return None, "navigation-link"

    score = quality_score(row["signal"], expires, source)
    description = clean_text(row["context"] or f"{source.name}: {title}", 420)
    url = row["url"]
    deal = {
        "id": f"wien-combined-{stable_id([url, title, source.name])}",
        "brand": source.name,
        "logo": infer_logo(source.category, deal_type),
        "title": title,
        "description": description,
        "type": deal_type,
        "category": source.category,
        "source": "Wien Deals Combined",
        "originSource": source.name,
        "url": url,
        "expires": expires,
        "validUntil": expiry_date.isoformat() if expiry_date else "",
        "distance": "Wien",
        "hot": deal_type in {"gratis", "bogo"} and score >= 68,
        "isNew": True,
        "priority": 5 if score >= 75 else 4,
        "votes": 2 if score >= 75 else 1,
        "qualityScore": score,
        "pubDate": NOW.isoformat(),
        "pubDateSource": "wien-deals-combined-run",
        "evidence": {
            "sourceUrl": source.url,
            "sourceDomain": source_domain(source.url),
            "textSample": clean_text(row["signal"], 500),
        },
        "reviewTier": "high" if score >= 75 else "review",
    }
    return deal, ""


def dedupe(deals: list[dict]) -> list[dict]:
    best_by_url: dict[str, dict] = {}
    for deal in deals:
        existing = best_by_url.get(deal["url"])
        if not existing or (deal["qualityScore"], len(deal["title"])) > (existing["qualityScore"], len(existing["title"])):
            best_by_url[deal["url"]] = deal

    best_by_key: dict[str, dict] = {}
    for deal in best_by_url.values():
        semantic = re.sub(r"[^a-z0-9]+", " ", normalize_ascii(f"{deal['title']} {deal['url']}")).strip()
        key = semantic[:180]
        existing = best_by_key.get(key)
        if not existing or deal["qualityScore"] > existing["qualityScore"]:
            best_by_key[key] = deal
    return sorted(
        best_by_key.values(),
        key=lambda item: (item["qualityScore"], item["type"] == "gratis", item["title"]),
        reverse=True,
    )[:MAX_DEALS]


def write_payload(path: Path, source: str, deals: list[dict], meta: dict | None = None) -> None:
    payload = {
        "lastUpdated": NOW.isoformat(),
        "source": source,
        "totalDeals": len(deals),
        "deals": deals,
    }
    if meta:
        payload["meta"] = meta
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    print("🌐 WIEN DEALS COMBINED")
    print(f"Current year guard: {CURRENT_YEAR}")

    accepted: list[dict] = []
    source_stats = []
    rejected_reasons: dict[str, int] = {}

    for source in SOURCES:
        print(f"\n📌 {source.name}: {source.url}")
        html, error = fetch_html(source)
        if error:
            print(f"   ❌ {error}")
            source_stats.append({"name": source.name, "url": source.url, "error": error, "accepted": 0, "candidates": 0})
            continue

        rows = candidate_links(html, source)
        source_deals: list[dict] = []
        for row in rows:
            deal, reason = build_deal(row, source)
            if deal:
                source_deals.append(deal)
            else:
                rejected_reasons[reason] = rejected_reasons.get(reason, 0) + 1

        accepted.extend(source_deals)
        print(f"   → {len(source_deals)} Deals aus {len(rows)} Kandidaten")
        source_stats.append({
            "name": source.name,
            "url": source.url,
            "candidates": len(rows),
            "accepted": len(source_deals),
            "evergreen": source.evergreen,
        })

    final_deals = dedupe(accepted)
    event_deals = [deal for deal in final_deals if deal["category"] in {"kultur", "bildung"}]

    meta = {
        "criteria": "Vienna + concrete free/discount/1+1/action signal, current-year guard, no expired explicit dates.",
        "maxDeals": MAX_DEALS,
        "sourcesVisited": len(SOURCES),
    }
    write_payload(OUTPUT_PATH, "wien-deals-combined", final_deals, meta)
    write_payload(EVENTS_PATH, "wien-deals-combined-events", event_deals, meta)
    write_payload(GEMEINDE_PATH, "wien-deals-combined-legacy-cleared", [], {"replacedBy": OUTPUT_PATH.name})
    write_payload(GOTTESDIENSTE_PATH, "wien-deals-combined-legacy-cleared", [], {"replacedBy": OUTPUT_PATH.name})

    report = {
        "generatedAt": NOW.isoformat(),
        "currentYear": CURRENT_YEAR,
        "totalAcceptedBeforeDedupe": len(accepted),
        "accepted": len(final_deals),
        "eventDeals": len(event_deals),
        "rejectedReasons": dict(sorted(rejected_reasons.items(), key=lambda item: item[1], reverse=True)),
        "sourceStats": source_stats,
        "outputs": [
            str(OUTPUT_PATH.relative_to(ROOT)),
            str(EVENTS_PATH.relative_to(ROOT)),
            str(GEMEINDE_PATH.relative_to(ROOT)),
            str(GOTTESDIENSTE_PATH.relative_to(ROOT)),
        ],
    }
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print("\n✅ Wien Deals Combined complete")
    print(f"   accepted: {len(final_deals)}")
    print(f"   events:   {len(event_deals)}")
    print(f"   output:   {OUTPUT_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
