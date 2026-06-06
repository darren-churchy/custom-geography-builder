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


def fetch_features(service_url: str, fields: str) -> list:
    query_url = f"{service_url}/query"
    params = {
        "where": "1=1",
        "outFields": fields,
        "outSR": "4326",
        "f": "geojson",
        "resultRecordCount": 2000,
        "resultOffset": 0,
    }
    features = []
    while True:
        resp = requests.get(query_url, params=params, timeout=120)
        resp.raise_for_status()
        data = resp.json()
        batch = data.get("features", [])
        features.extend(batch)
        print(f"  …{len(features)} features fetched", end="\r", flush=True)
        if not data.get("exceededTransferLimit", False):
            break
        params["resultOffset"] += len(batch)
    print(f"  {len(features)} total")
    return features


def main():
    print("Fetching LSOA 2021 boundaries (England & Wales)…")
    features = fetch_features(LSOA_URL, "LSOA21CD")

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
