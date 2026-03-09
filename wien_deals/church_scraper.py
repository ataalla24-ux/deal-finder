#!/usr/bin/env python3
"""
Real scraper for freikirchliche Gemeinden, Gottesdienste and christliche Events in Vienna.

This replaces the old static church list with a curated source set that only includes
freikirchliche / evangelical-style communities the app should surface.
"""
from __future__ import annotations

import html
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime
from typing import Iterable

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "docs")

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36"
)

MAX_TEXT_CHARS = 80000
REQUEST_TIMEOUT = 20

SERVICE_PATTERNS = [
    r"(samstag[^.:\n]{0,60}\d{1,2}[:.]\d{2}(?:\s*uhr)?)",
    r"(sonntag[^.:\n]{0,60}\d{1,2}[:.]\d{2}(?:\s*uhr)?)",
    r"(celebration[^.:\n]{0,80}\d{1,2}[:.]\d{2})",
    r"(gottesdienst[^.:\n]{0,80}\d{1,2}[:.]\d{2})",
    r"(online church[^.:\n]{0,60}\d{1,2}[:.]\d{2})",
]

SERVICE_HINT_PATTERNS = [
    r"(live gottesdienst[^.\n]{0,120})",
    r"(gottesdienste?[^.\n]{0,120})",
    r"(celebrations?[^.\n]{0,120})",
    r"(online church[^.\n]{0,120})",
]

EVENT_PATTERNS = [
    r"(events?[^.\n]{0,120})",
    r"(eventkalender[^.\n]{0,120})",
    r"(workshops?[^.\n]{0,120})",
    r"(youth[^.\n]{0,120})",
    r"(jugend[^.\n]{0,120})",
    r"(small groups?[^.\n]{0,120})",
    r"(communit(?:y|ies)[^.\n]{0,120})",
    r"(connect[^.\n]{0,120})",
]

CHURCH_PATTERNS = [
    r"(freikirche[^.\n]{0,160})",
    r"(kirche[^.\n]{0,160})",
    r"(gemeinschaft[^.\n]{0,160})",
    r"(gebet[^.\n]{0,160})",
    r"(pastoren?[^.\n]{0,160})",
]

EXCLUDED_TERMS = {
    "kathol",
    "advent",
    "mennonit",
    "orthodox",
    "synagoge",
    "methodist",
    "gewerkschaft",
    "mitgliederversammlung",
}


@dataclass
class Source:
    slug: str
    name: str
    homepage: str
    aliases: list[str] = field(default_factory=list)
    known_location: str = "Wien"
    known_address: str | None = None
    extra_paths: list[str] = field(default_factory=list)


SOURCES = [
    Source(
        slug="jesuszentrum",
        name="VCC JesusZentrum",
        homepage="https://www.jesuszentrum.at",
        aliases=["Jesus Zentrum Wien", "VCC SkyCampus", "SkyCampus Gasometer"],
        known_location="1110 Wien",
        known_address="Guglgasse 11, 1110 Wien",
        extra_paths=["/events", "/connect", "/neu-hier"],
    ),
    Source(
        slug="icf-wien",
        name="ICF Wien",
        homepage="https://www.icf-wien.at",
        aliases=["International Christian Fellowship Wien"],
        known_location="1070 Wien",
        known_address="Lerchenfelder Straße 35, 1070 Wien",
        extra_paths=["/de/gottesdienste/", "/de/events/", "/de/anschluss-finden/"],
    ),
    Source(
        slug="cig-wien",
        name="CIG Wien",
        homepage="https://www.cigwien.at",
        aliases=["Christliche Internationale Gemeinde Wien"],
        known_location="1100 Wien",
        known_address="Leebgasse 34, 1100 Wien",
        extra_paths=["/gottesdienste/", "/veranstaltungen/", "/kontakt/"],
    ),
    Source(
        slug="hillsong-vienna",
        name="Hillsong Vienna",
        homepage="https://hillsong.com/austria/",
        aliases=["Hillsong Austria", "Hillsong Wien"],
        known_location="1010 Wien",
        known_address="Palais Berg, Schwarzenbergplatz 3, 1010 Wien",
        extra_paths=["/austria/gottesdienste-2/", "/austria/events/", "/austria/neubeihillsongwien/"],
    ),
]


def log(message: str) -> None:
    print(message)


def build_logo_url(homepage: str) -> str:
    parsed = urllib.parse.urlparse(homepage)
    origin = f"{parsed.scheme}://{parsed.netloc}" if parsed.scheme and parsed.netloc else homepage
    return f"https://www.google.com/s2/favicons?sz=128&domain_url={urllib.parse.quote(origin, safe=':/')}"


def normalize_expiry(value: str) -> str:
    text = " ".join(str(value or "").split()).strip()
    if not text:
        return ""
    if re.search(r"\b(zeiten? auf webseite prüfen|aktuelle termine auf webseite|siehe details|regelmäßig|regelmaessig|ongoing|not specified)\b", text, re.IGNORECASE):
        return ""
    if re.search(r"\b\d{1,2}[.:]\d{2}\b", text):
        return text
    if re.search(r"\b\d{1,2}\.\d{1,2}\.\d{2,4}\b", text):
        return text
    if re.search(r"\b(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\b", text, re.IGNORECASE):
        return text
    return ""


def fetch_url(url: str) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
        },
    )
    with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT) as response:
        content_type = response.headers.get("Content-Type", "")
        if "text/html" not in content_type and "application/xhtml+xml" not in content_type:
            return ""
        body = response.read().decode("utf-8", "ignore")
        return body[:MAX_TEXT_CHARS]


def strip_html(raw_html: str) -> str:
    cleaned = re.sub(r"(?is)<script.*?>.*?</script>", " ", raw_html)
    cleaned = re.sub(r"(?is)<style.*?>.*?</style>", " ", cleaned)
    cleaned = re.sub(r"(?is)<noscript.*?>.*?</noscript>", " ", cleaned)
    cleaned = re.sub(r"(?i)<br\s*/?>", "\n", cleaned)
    cleaned = re.sub(r"(?is)</(p|div|section|article|li|h1|h2|h3|h4|h5|h6)>", "\n", cleaned)
    cleaned = re.sub(r"(?is)<[^>]+>", " ", cleaned)
    cleaned = html.unescape(cleaned)
    cleaned = cleaned.replace("\xa0", " ")
    cleaned = re.sub(r"\s+\n", "\n", cleaned)
    cleaned = re.sub(r"\n{2,}", "\n", cleaned)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    return cleaned.strip()


def normalize_snippet(snippet: str) -> str:
    snippet = strip_html(snippet)
    snippet = re.sub(r"\s+", " ", snippet)
    return snippet.strip(" -|,:;")


def collect_matches(text: str, patterns: Iterable[str], limit: int = 4) -> list[str]:
    matches: list[str] = []
    seen: set[str] = set()
    for pattern in patterns:
        for match in re.finditer(pattern, text, re.IGNORECASE):
            snippet = normalize_snippet(match.group(1))
            lower = snippet.lower()
            if len(snippet) < 8:
                continue
            if lower in seen:
                continue
            if any(term in lower for term in EXCLUDED_TERMS):
                continue
            seen.add(lower)
            matches.append(snippet)
            if len(matches) >= limit:
                return matches
    return matches


def extract_meta_description(raw_html: str) -> str | None:
    match = re.search(
        r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)["\']',
        raw_html,
        re.IGNORECASE,
    )
    if not match:
        return None
    snippet = normalize_snippet(match.group(1))
    return snippet or None


def extract_title(raw_html: str) -> str | None:
    match = re.search(r"(?is)<title>(.*?)</title>", raw_html)
    if not match:
        return None
    return normalize_snippet(match.group(1)) or None


def absolutize(base_url: str, maybe_relative: str) -> str:
    return urllib.parse.urljoin(base_url, maybe_relative)


def extract_link_candidates(source: Source, raw_html: str) -> list[str]:
    candidates = set()
    for match in re.finditer(r'href=["\']([^"\']+)["\']', raw_html, re.IGNORECASE):
        href = match.group(1).strip()
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue
        lowered = href.lower()
        if any(term in lowered for term in ("event", "gottes", "celebration", "connect", "community")):
            candidates.add(absolutize(source.homepage, href))
    for path in source.extra_paths:
        candidates.add(absolutize(source.homepage, path))
    filtered = []
    for url in sorted(candidates):
        if urllib.parse.urlparse(url).netloc and urllib.parse.urlparse(url).netloc not in urllib.parse.urlparse(source.homepage).netloc:
            continue
        filtered.append(url)
    return filtered[:6]


def build_deal(
    *,
    source: Source,
    kind: str,
    title: str,
    description: str,
    url: str,
    expires: str,
    priority: int,
) -> dict:
    now = datetime.now().isoformat()
    normalized_expires = normalize_expiry(expires)
    location = source.known_address or source.known_location
    return {
        "id": f"{source.slug}-{kind}-{datetime.now().strftime('%Y%m%d')}",
        "brand": source.name,
        "logo": "⛪" if kind == "kirche" else ("🕊️" if kind == "gottesdienste" else "🎉"),
        "logoUrl": build_logo_url(source.homepage),
        "title": title,
        "description": description,
        "type": "gratis",
        "category": kind,
        "source": "Freikirchen Wien",
        "url": url,
        "expires": normalized_expires,
        "address": location,
        "distance": location,
        "location": location,
        "hot": False,
        "isNew": True,
        "priority": priority,
        "votes": 0,
        "qualityScore": 72 if kind == "kirche" else (78 if kind == "gottesdienste" else 74),
        "pubDate": now,
    }


def looks_like_supported_free_church(source: Source, title: str, meta_description: str | None, text: str) -> bool:
    haystack = " ".join(
        part for part in [title, meta_description or "", text[:4000], " ".join(source.aliases), source.name] if part
    ).lower()
    if any(term in haystack for term in EXCLUDED_TERMS):
        return False
    positive_markers = [
        source.name.lower(),
        *[alias.lower() for alias in source.aliases],
        "freikirche",
        "gottesdienst",
        "celebration",
        "community",
        "kirche",
    ]
    return sum(marker in haystack for marker in positive_markers) >= 2


def scrape_source(source: Source) -> tuple[list[dict], list[dict], list[dict]]:
    log(f"🔎 {source.name} ({source.homepage})")
    try:
        homepage_html = fetch_url(source.homepage)
    except urllib.error.HTTPError as exc:
        log(f"   → skip: HTTP {exc.code}")
        return [], [], []
    except Exception as exc:  # pragma: no cover - network variance
        log(f"   → skip: {exc}")
        return [], [], []

    title = extract_title(homepage_html) or source.name
    meta_description = extract_meta_description(homepage_html)
    homepage_text = strip_html(homepage_html)

    if not looks_like_supported_free_church(source, title, meta_description, homepage_text):
        log("   → skip: Inhalt passt nicht zu Freikirchen-Quelle")
        return [], [], []

    church_matches = collect_matches(homepage_text, CHURCH_PATTERNS, limit=3)
    service_matches = collect_matches(homepage_text, SERVICE_PATTERNS, limit=3)
    service_hints = collect_matches(homepage_text, SERVICE_HINT_PATTERNS, limit=3)
    event_matches = collect_matches(homepage_text, EVENT_PATTERNS, limit=3)

    linked_urls = extract_link_candidates(source, homepage_html)
    linked_texts: list[tuple[str, str]] = []
    seen_urls = set()
    for url in linked_urls:
        if url in seen_urls:
            continue
        seen_urls.add(url)
        try:
            linked_html = fetch_url(url)
        except Exception:
            continue
        linked_text = strip_html(linked_html)
        if not linked_text:
            continue
        linked_texts.append((url, linked_text))

    for url, linked_text in linked_texts:
        if len(service_matches) < 4:
            service_matches.extend(
                match
                for match in collect_matches(linked_text, SERVICE_PATTERNS, limit=4)
                if match.lower() not in {m.lower() for m in service_matches}
            )
        if len(service_hints) < 4:
            service_hints.extend(
                match
                for match in collect_matches(linked_text, SERVICE_HINT_PATTERNS, limit=4)
                if match.lower() not in {m.lower() for m in service_hints}
            )
        if len(event_matches) < 4:
            event_matches.extend(
                match
                for match in collect_matches(linked_text, EVENT_PATTERNS, limit=4)
                if match.lower() not in {m.lower() for m in event_matches}
            )
        if len(church_matches) < 4:
            church_matches.extend(
                match
                for match in collect_matches(linked_text, CHURCH_PATTERNS, limit=4)
                if match.lower() not in {m.lower() for m in church_matches}
            )

    description_lines = []
    if meta_description:
        description_lines.append(meta_description)
    description_lines.extend(church_matches[:2])
    if not description_lines:
        description_lines.append(f"{source.name} in Wien mit offizieller Webseite und aktuellen Infos.")

    church_deal = build_deal(
        source=source,
        kind="kirche",
        title=source.name,
        description=(
            f"⛪ {title}\n"
            f"📍 {source.known_address or source.known_location}\n"
            f"📝 {' | '.join(description_lines[:3])}"
        ),
        url=source.homepage,
        expires="Regelmäßig",
        priority=2,
    )

    gottesdienste: list[dict] = []
    if service_matches or service_hints:
        gottesdienst_url = next(
            (
                url
                for url in linked_urls
                if any(term in url.lower() for term in ("gottes", "celebration", "service", "services"))
            ),
            source.homepage,
        )
        service_parts = service_matches[:3] or service_hints[:3]
        gottesdienste.append(
            build_deal(
                source=source,
                kind="gottesdienste",
                title=f"{source.name} Gottesdienste",
                description=(
                    f"🕊️ {source.name}\n"
                    f"📍 {source.known_address or source.known_location}\n"
                    f"🕐 {' | '.join(service_parts)}"
                ),
                url=gottesdienst_url,
                expires="Zeiten auf Webseite prüfen",
                priority=1,
            )
        )

    events: list[dict] = []
    if event_matches:
        event_url = next(
            (
                url
                for url in linked_urls
                if any(term in url.lower() for term in ("event", "events2", "veranstaltung"))
            ),
            source.homepage,
        )
        events.append(
            build_deal(
                source=source,
                kind="events",
                title=f"{source.name} Events",
                description=(
                    f"🎉 {source.name}\n"
                    f"📍 {source.known_address or source.known_location}\n"
                    f"📝 {' | '.join(event_matches[:3])}"
                ),
                url=event_url,
                expires="Aktuelle Termine auf Webseite",
                priority=2,
            )
        )

    return [church_deal], gottesdienste, events


def save_payload(filename: str, source_name: str, deals: list[dict]) -> None:
    path = os.path.join(OUTPUT_DIR, filename)
    payload = {
        "lastUpdated": datetime.now().isoformat(),
        "source": source_name,
        "totalDeals": len(deals),
        "deals": deals,
    }
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
    log(f"💾 {filename}: {len(deals)}")


def main() -> int:
    log("=== Freikirchen Wien Scraper ===")
    log("Nur echte Freikirchen / evangelikale Gemeinden in Wien.\n")

    all_churches: list[dict] = []
    all_services: list[dict] = []
    all_events: list[dict] = []

    for source in SOURCES:
        churches, services, events = scrape_source(source)
        all_churches.extend(churches)
        all_services.extend(services)
        all_events.extend(events)

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    save_payload("deals-pending-church-gemeinde.json", "freikirchen-wien", all_churches)
    save_payload("deals-pending-church-gottesdienste.json", "freikirchen-wien", all_services)
    save_payload("deals-pending-church-events.json", "freikirchen-wien", all_events)

    log("\n=== Summary ===")
    log(f"Kirche: {len(all_churches)}")
    log(f"Gottesdienste: {len(all_services)}")
    log(f"Events: {len(all_events)}")
    log(f"Gesamt: {len(all_churches) + len(all_services) + len(all_events)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
