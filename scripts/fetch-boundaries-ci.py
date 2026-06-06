#!/usr/bin/env python3
"""
fetch-boundaries-ci.py
----------------------
CI script: downloads LSOA 2021 boundaries (England & Wales) from the ONS Open
Geography Portal and converts to a quantised TopoJSON ready for the app to serve.

Output: public/data/boundaries.topojson  (object name: lsoa, code field: LSOA21CD)

If the build fails with "Cannot find a working LSOA service", the ONS has probably
published a new service version. Visit the URL in the error message, find the
current service name, and add it to CANDIDATE_URLS below.

Typical CI run time: 2–5 minutes.
"""

import json
import subprocess
import sys
from pathlib import Path

import requests

OUTPUT_DIR = Path(__file__).parent.parent / "public" / "data"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

TMP_GEOJSON = OUTPUT_DIR / "_ci_lsoa_ew.geojson"
OUTPUT_TOPO = OUTPUT_DIR / "boundaries.topojson"

ONS_BASE = "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services"

# Known service URLs, most recent first.
# ONS publishes new versions (V3, V4…) as they release boundary revisions.
# If all of these fail, the script will try to auto-discover the correct URL.
# Find the latest at: https://geoportal.statistics.gov.uk/search?q=LSOA+2021+EW+BGC
CANDIDATE_URLS = [
    f"{ONS_BASE}/Lower_layer_Super_Output_Areas_Dec_2021_Boundaries_EW_BGC_V4/FeatureServer/0",
    f"{ONS_BASE}/Lower_layer_Super_Output_Areas_Dec_2021_Boundaries_EW_BGC_V3/FeatureServer/0",
    f"{ONS_BASE}/Lower_layer_Super_Output_Areas_Dec_2021_Boundaries_EW_BGC_V2/FeatureServer/0",
    f"{ONS_BASE}/Lower_layer_Super_Output_Areas_December_2021_Boundaries_EW_BGC_V3/FeatureServer/0",
]

# England & Wales has ~35,000 LSOAs. Fail loudly if we get fewer than this.
MIN_EXPECTED = 30_000

HEADERS = {
    "User-Agent": (
        "custom-geography-builder/1.0 "
        "(github.com/darren-churchy/custom-geography-builder)"
    )
}


# ---------------------------------------------------------------------------
# Service discovery
# ---------------------------------------------------------------------------

def count_features(service_url: str) -> int:
    """Quick count query — returns 0 on any failure or empty service."""
    try:
        resp = requests.get(
            f"{service_url}/query",
            headers=HEADERS,
            params={"where": "1=1", "returnCountOnly": "true", "f": "json"},
            timeout=20,
        )
        if not resp.ok:
            return 0
        data = resp.json()
        if "error" in data:
            return 0
        return int(data.get("count", 0))
    except Exception:
        return 0


def discover_service_url() -> str:
    """
    Probe candidate URLs in order, then fall back to listing all ONS services.
    Calls sys.exit(1) with clear instructions if nothing works.
    """
    print("  Probing known service URLs…")
    for url in CANDIDATE_URLS:
        short = url.split("/services/")[1].split("/FeatureServer")[0]
        n = count_features(url)
        status = f"{n:,} features" if n else "empty / not found"
        print(f"    {short}: {status}")
        if n >= MIN_EXPECTED:
            return url

    # Auto-discovery: list all FeatureServer services and find a match
    print("  Known URLs have no data — scanning ONS service catalogue…")
    try:
        resp = requests.get(f"{ONS_BASE}?f=json", headers=HEADERS, timeout=30)
        resp.raise_for_status()
        all_services = resp.json().get("services", [])
        keywords = ["lsoa", "2021", "ew", "bgc"]
        matches = [
            s for s in all_services
            if s.get("type") == "FeatureServer"
            and all(k in s.get("name", "").lower() for k in keywords)
        ]
        # Sort descending so the highest version is tried first
        matches.sort(key=lambda s: s.get("name", ""), reverse=True)
        for svc in matches:
            discovered = f"{ONS_BASE}/{svc['name']}/FeatureServer/0"
            n = count_features(discovered)
            print(f"    Discovered {svc['name']}: {n:,} features")
            if n >= MIN_EXPECTED:
                print(f"  → Add to CANDIDATE_URLS: {discovered}")
                return discovered
    except Exception as exc:
        print(f"  Service catalogue scan failed: {exc}")

    print()
    print("ERROR: Cannot find a working LSOA 2021 EW BGC service.")
    print("To fix, find the current service name at:")
    print("  https://geoportal.statistics.gov.uk/search?q=LSOA+2021+EW+BGC")
    print("Then add it to CANDIDATE_URLS in scripts/fetch-boundaries-ci.py.")
    sys.exit(1)


# ---------------------------------------------------------------------------
# Fetch helpers
# ---------------------------------------------------------------------------

def get_batch_size(service_url: str) -> int:
    try:
        resp = requests.get(f"{service_url}?f=json", headers=HEADERS, timeout=20)
        max_rc = resp.json().get("maxRecordCount")
        return min(int(max_rc), 1000) if max_rc else 500
    except Exception:
        return 500


def fetch_all_ids(service_url: str) -> list:
    resp = requests.get(
        f"{service_url}/query",
        headers=HEADERS,
        params={"where": "1=1", "returnIdsOnly": "true", "f": "json"},
        timeout=60,
    )
    if not resp.ok:
        print(f"  returnIdsOnly failed: HTTP {resp.status_code}")
        print(f"  Response: {resp.text[:400]}")
        resp.raise_for_status()
    data = resp.json()
    return data.get("objectIds") or []


def fetch_by_ids(service_url: str, ids: list, fields: str, batch_size: int) -> list:
    features = []
    total = len(ids)
    for i in range(0, total, batch_size):
        batch = ids[i : i + batch_size]
        resp = requests.get(
            f"{service_url}/query",
            headers=HEADERS,
            params={
                "objectIds": ",".join(str(x) for x in batch),
                "outFields": fields,
                "returnGeometry": "true",
                "f": "geojson",
            },
            timeout=120,
        )
        if not resp.ok:
            print(f"\n  HTTP {resp.status_code} on batch starting at {i}")
            print(f"  Response: {resp.text[:400]}")
            resp.raise_for_status()
        features.extend(resp.json().get("features", []))
        print(f"  …{len(features)}/{total}", end="\r", flush=True)
    print(f"  {len(features)} features fetched          ")
    return features


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def assert_count(label: str, count: int) -> None:
    """Fail loudly if count is below the minimum threshold."""
    if count < MIN_EXPECTED:
        print(f"\nERROR: {label} is {count} — expected ≥ {MIN_EXPECTED:,}.")
        print("If the ONS service URL has changed, update CANDIDATE_URLS in")
        print("scripts/fetch-boundaries-ci.py and retry the build.")
        sys.exit(1)
    print(f"  ✓ {label}: {count:,}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("Locating LSOA 2021 service (England & Wales)…")
    service_url = discover_service_url()
    print(f"  Service URL: {service_url}")

    batch_size = get_batch_size(service_url)
    print(f"  Batch size: {batch_size}")

    print("Fetching all object IDs…")
    ids = fetch_all_ids(service_url)
    assert_count("Object ID count", len(ids))

    print("Fetching feature geometries in batches by objectId…")
    features = fetch_by_ids(service_url, ids, "LSOA21CD", batch_size)
    assert_count("Feature count", len(features))

    fc = {"type": "FeatureCollection", "features": features}
    TMP_GEOJSON.write_text(json.dumps(fc))
    print(f"  GeoJSON written: {TMP_GEOJSON.stat().st_size / 1e6:.1f} MB")

    print("Converting to quantised TopoJSON via mapshaper…")
    cmd = [
        "mapshaper", str(TMP_GEOJSON),
        "-rename-layers", "lsoa",
        "-simplify", "10%", "keep-shapes",
        "-o", str(OUTPUT_TOPO),
        "format=topojson", "quantization=1e5",
        "presimplify",
    ]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        print("mapshaper error:")
        print(result.stderr.decode())
        sys.exit(1)

    # Validate the output TopoJSON has the expected geometry count
    topo = json.loads(OUTPUT_TOPO.read_text())
    n_geom = len(topo.get("objects", {}).get("lsoa", {}).get("geometries", []))
    assert_count("TopoJSON geometry count", n_geom)

    size_mb = OUTPUT_TOPO.stat().st_size / 1e6
    print(f"  TopoJSON written: {size_mb:.1f} MB  →  {OUTPUT_TOPO}")
    TMP_GEOJSON.unlink()
    print("Done — boundaries ready.")


if __name__ == "__main__":
    main()
