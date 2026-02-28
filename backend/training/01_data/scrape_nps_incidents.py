"""
Scrape and parse NPS Morning Report incident history for Yosemite.

Source: https://npshistory.com/morningreport/incidents/yose.htm
        (and any paginated continuation pages at yose2.htm, yose3.htm, etc.)

Output: 01_data/output/nps_incidents.csv
Columns: date, year, month, lat, lon, location_raw, incident_type, description, geocode_method

Run:
    python 01_data/scrape_nps_incidents.py
"""
import csv
import json
import logging
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

import requests
from bs4 import BeautifulSoup
from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut, GeocoderServiceError

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────
BASE_URLS = [
    "https://npshistory.com/morningreport/incidents/yose.htm",
    "https://npshistory.com/morningreport/incidents/yose2.htm",
    "https://npshistory.com/morningreport/incidents/yose3.htm",
    "https://npshistory.com/morningreport/incidents/yose4.htm",
    "https://npshistory.com/morningreport/incidents/yose5.htm",
]

HERE = Path(__file__).parent
OUTPUT_DIR = HERE / "output"
OUTPUT_FILE = OUTPUT_DIR / "nps_incidents.csv"
ALIASES_FILE = HERE / "location_aliases.json"

# Yosemite bbox (used as fallback centre when geocoding fails entirely)
YOSEMITE_LAT = 37.7459
YOSEMITE_LON = -119.5332

# ── Incident-type keyword map ─────────────────────────────────────────────────
KEYWORD_TYPES: list[tuple[list[str], str]] = [
    (["fell", "fall", "fallen", "falling", "slipped", "slid"], "fall"),
    (["drown", "drowned", "drowning", "swept", "submerged", "water"], "drowning"),
    (["climb", "climbing", "climber", "rappel", "rappelling", "belay"], "fall"),  # climbing falls → fall
    (["vehicle", "car", "truck", "motorcycle", "auto", "collision", "crash", "accident"], "vehicle"),
    (["lightning", "struck by lightning", "thunder"], "lightning"),
    (["rock", "rockfall", "rockslide", "boulder", "debris"], "rockfall"),
    (["missing", "search", "overdue", "lost", "not returned"], "search_rescue"),
    (["cardiac", "heart", "stroke", "seizure", "diabetic", "medical", "altitude", "insulin"], "medical"),
    (["fire", "smoke", "burn", "arson"], "fire_related"),
]

VALID_INCIDENT_TYPES = {
    "fall", "drowning", "medical", "vehicle", "rockfall",
    "lightning", "search_rescue", "fire_related", "unknown",
}


def load_aliases() -> dict:
    with open(ALIASES_FILE) as f:
        raw = json.load(f)
    return {k.lower(): v for k, v in raw.items() if not k.startswith("_")}


def classify_incident(text: str) -> str:
    """Return best-match incident type from keyword scan of description text."""
    lower = text.lower()
    for keywords, itype in KEYWORD_TYPES:
        if any(kw in lower for kw in keywords):
            return itype
    return "unknown"


def geocode_location(
    raw_loc: str,
    aliases: dict,
    geocoder: Nominatim,
) -> tuple[Optional[float], Optional[float], str]:
    """
    Returns (lat, lon, method_string).
    Priority: alias table → Nominatim → None.
    """
    # 1. Exact alias match
    key = raw_loc.strip().lower()
    if key in aliases:
        entry = aliases[key]
        return entry["lat"], entry["lon"], "alias_exact"

    # 2. Partial alias match (longest matching alias that appears in raw text)
    best_alias = None
    best_len = 0
    for alias_key, entry in aliases.items():
        if alias_key in key and len(alias_key) > best_len:
            best_alias = entry
            best_len = len(alias_key)
    if best_alias:
        return best_alias["lat"], best_alias["lon"], "alias_partial"

    # 3. Nominatim geocoding (rate-limited)
    query = f"{raw_loc.strip()}, Yosemite National Park, California"
    try:
        time.sleep(1.1)  # Nominatim 1 req/sec policy
        result = geocoder.geocode(query, timeout=10)
        if result:
            return result.latitude, result.longitude, "nominatim"
    except (GeocoderTimedOut, GeocoderServiceError) as exc:
        log.debug("Nominatim failed for '%s': %s", raw_loc, exc)

    return None, None, "failed"


def extract_location_from_text(text: str) -> str:
    """
    Heuristically extract a location mention from incident description text.
    Returns best candidate string or empty string.
    """
    # Common patterns: "at Half Dome", "on Mist Trail", "near El Capitan", "below Nevada Fall"
    patterns = [
        r"(?:at|on|near|below|above|along|from|off|in)\s+([A-Z][A-Za-z\s/'-]{3,40}?)(?:\s*[\.,;\(]|$)",
        r"([A-Z][A-Za-z\s/'-]{3,40}?)\s+(?:Trail|Falls?|Creek|Road|Dome|Peak|Ridge|Wall|Face|Base|Cliff)",
    ]
    for pat in patterns:
        m = re.search(pat, text)
        if m:
            return m.group(1).strip()
    return ""


def parse_page(html: str) -> list[dict]:
    """Parse a single page of NPS Morning Report HTML into incident dicts."""
    soup = BeautifulSoup(html, "lxml")
    text = soup.get_text(separator="\n")
    lines = text.splitlines()

    incidents: list[dict] = []
    current: dict | None = None
    desc_lines: list[str] = []

    # Date header pattern: "May 8, 1986" or "August 15, 1986" etc.
    date_pat = re.compile(
        r"^(January|February|March|April|May|June|July|August|September|October|November|December)"
        r"\s+\d{1,2},?\s+\d{4}",
        re.IGNORECASE,
    )
    # Incident number line: "86-271" or "Incident 87-123:"
    inc_num_pat = re.compile(r"\b\d{2}-\d{3,4}\b")

    for line in lines:
        line = line.strip()
        if not line:
            continue

        date_m = date_pat.match(line)
        if date_m:
            # Save previous
            if current and desc_lines:
                current["description"] = " ".join(desc_lines).strip()
                incidents.append(current)
            desc_lines = []
            try:
                # Normalise date string (remove stray commas)
                clean = re.sub(r"(\d{1,2}),?\s+(\d{4})", r"\1 \2", line.split(".")[0])
                dt = datetime.strptime(clean.strip(), "%B %d %Y")
                current = {
                    "date": dt.strftime("%Y-%m-%d"),
                    "year": dt.year,
                    "month": dt.month,
                    "description": "",
                    "location_raw": "",
                    "incident_type": "unknown",
                    "lat": None,
                    "lon": None,
                    "geocode_method": "",
                }
            except ValueError:
                current = None
            continue

        if current is not None:
            desc_lines.append(line)

    # Flush last incident
    if current and desc_lines:
        current["description"] = " ".join(desc_lines).strip()
        incidents.append(current)

    return incidents


def fetch_all_pages() -> list[dict]:
    """Fetch all known page URLs; stop on 404."""
    all_incidents: list[dict] = []
    session = requests.Session()
    session.headers["User-Agent"] = "trAIl-data-pipeline/1.0 (research; contact: trailguardian@example.com)"

    for url in BASE_URLS:
        log.info("Fetching %s", url)
        try:
            resp = session.get(url, timeout=20)
            if resp.status_code == 404:
                log.info("  404 — stopping pagination at %s", url)
                break
            resp.raise_for_status()
            page_incidents = parse_page(resp.text)
            log.info("  Found %d incidents", len(page_incidents))
            all_incidents.extend(page_incidents)
            time.sleep(0.5)
        except requests.RequestException as exc:
            log.warning("  Failed to fetch %s: %s", url, exc)
            break

    return all_incidents


def enrich_incidents(incidents: list[dict], aliases: dict, geocoder: Nominatim) -> list[dict]:
    """Add incident_type, location_raw, lat/lon to each incident."""
    enriched = []
    for inc in incidents:
        desc = inc["description"]

        # Classify type
        inc["incident_type"] = classify_incident(desc)

        # Extract and geocode location
        loc_raw = extract_location_from_text(desc)
        inc["location_raw"] = loc_raw
        if loc_raw:
            lat, lon, method = geocode_location(loc_raw, aliases, geocoder)
        else:
            lat, lon, method = None, None, "no_location_extracted"

        inc["lat"] = lat
        inc["lon"] = lon
        inc["geocode_method"] = method
        enriched.append(inc)

    return enriched


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    aliases = load_aliases()
    geocoder = Nominatim(user_agent="trAIl-data-pipeline")

    log.info("Fetching NPS Morning Report incident pages...")
    incidents = fetch_all_pages()
    log.info("Total incidents parsed: %d", len(incidents))

    log.info("Enriching with incident types and geocoding...")
    incidents = enrich_incidents(incidents, aliases, geocoder)

    geocoded = sum(1 for i in incidents if i["lat"] is not None)
    log.info("Geocoded: %d / %d (%.0f%%)", geocoded, len(incidents), 100 * geocoded / max(len(incidents), 1))

    # Write CSV
    fieldnames = ["date", "year", "month", "lat", "lon", "location_raw",
                  "incident_type", "geocode_method", "description"]
    with open(OUTPUT_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(incidents)

    log.info("Written to %s", OUTPUT_FILE)

    # Summary
    from collections import Counter
    type_counts = Counter(i["incident_type"] for i in incidents)
    log.info("Incident type distribution: %s", dict(type_counts.most_common()))


if __name__ == "__main__":
    main()
