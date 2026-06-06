#!/usr/bin/env python3
"""
fetch-boundaries-ci.py
----------------------
CI script: downloads LSOA 2021 boundaries (England & Wales) from the ONS Open
Geography Portal and converts to a quantised TopoJSON ready for the app to serve.

Output: public/data/boundaries.topojson  (object name: lsoa, code field: LSOA21CD)

Typical CI run time: 2–5 minutes.
Can also be run locally for quick setup — no mapshaper config needed beyond:
  pip install requests && npm install -g mapshaper
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

LSOA_URL = (
    "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services"
    "/Lower_layer_Super_Output_Areas_Dec_2021_Boundaries_EW_BGC_V2/FeatureServer/0"
)

HEADERS = {
    "User-Agent": (
        "custom-geography-builder/1.0 "
        "(github.com/darren-churchy/custom-geography-builder)"
    )
}


def get_service_info(service_url: str) -> dict:
    resp = requests.get(f"{service_url}?f=json", headers=HEADERS, timeout=30)
    resp.raise_for_status()
    return resp.json()


def fetch_all_ids(service_url: str) -> list:
    """Get every objectId in one lightweight query — no geometry, no pagination."""
    resp = requests.get(
        f"{service_url}/query",
        headers=HEADERS,
        params={"where": "1=1", "returnIdsOnly": "true", "f": "json"},
        timeout=60,
    )
    if not resp.ok:
        print(f"  returnIdsOnly failed: HTTP {resp.status_code}")
        print(f"  {resp.text[:400]}")
        resp.raise_for_status()
    return resp.json().get("objectIds", [])


def fetch_by_ids(service_url: str, ids: list, fields: str, batch_size: int) -> list:
    """
    Fetch features in batches keyed by objectId.
    Avoids resultOffset/resultRecordCount pagination which some ArcGIS
    service versions reject.
    """
    features = []
    total = len(ids)
    for i in range(0, total, batch_size):
        batch = ids[i : i + batch_size]
        params = {
            "objectIds": ",".join(str(x) for x in batch),
            "outFields": fields,
            "returnGeometry": "true",
            "f": "geojson",
        }
        resp = requests.get(
            f"{service_url}/query", headers=HEADERS, params=params, timeout=120
        )
        if not resp.ok:
            print(f"\n  HTTP {resp.status_code} on batch {i}–{i + len(batch)}")
            print(f"  {resp.text[:400]}")
            resp.raise_for_status()
        features.extend(resp.json().get("features", []))
        print(f"  …{len(features)}/{total} features", end="\r", flush=True)
    print(f"  {total} features fetched          ")
    return features


def main():
    print("Querying LSOA 2021 service metadata…")
    info = get_service_info(LSOA_URL)
    batch_size = min(int(info.get("maxRecordCount", 1000)), 1000)
    print(f"  maxRecordCount={info.get('maxRecordCount')}, using batch size={batch_size}")

    print("Fetching all object IDs…")
    ids = fetch_all_ids(LSOA_URL)
    print(f"  {len(ids)} object IDs found")

    print("Fetching feature geometries in batches by objectId…")
    features = fetch_by_ids(LSOA_URL, ids, "LSOA21CD", batch_size)

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

    size_mb = OUTPUT_TOPO.stat().st_size / 1e6
    print(f"  TopoJSON written: {size_mb:.1f} MB  →  {OUTPUT_TOPO}")
    TMP_GEOJSON.unlink()
    print("Done — boundaries ready.")


if __name__ == "__main__":
    main()
