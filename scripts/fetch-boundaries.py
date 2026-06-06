#!/usr/bin/env python3
"""
fetch-boundaries.py
-------------------
Downloads generalised, clipped OA and LSOA boundary products for Great Britain
from the ONS Open Geography Portal (England & Wales) and the Scottish Government
ArcGIS service (Scotland).

Converts each to quantised TopoJSON using mapshaper, then reports file sizes so
you can decide whether to use OA or LSOA as the atomic building block.

Requirements:
  pip install requests
  npm install -g mapshaper   (or use the mapshaper CLI from the npm package)

Outputs written to public/data/:
  gb-oa-generalised.topojson    (for display + export if OA chosen)
  gb-lsoa-generalised.topojson  (for display + export if LSOA chosen)

After benchmarking, update OBJECT_NAME and CODE_PROP in src/App.tsx.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

import requests

OUTPUT_DIR = Path(__file__).parent.parent / "public" / "data"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# ONS ArcGIS REST API — England & Wales
# ---------------------------------------------------------------------------
# Verify these service URLs at https://geoportal.statistics.gov.uk/ if they
# return errors — service IDs change when new vintages are published.
# Filter: "BGC" = Boundary Generalised Clipped (best for web display).

ONS_SERVICES = {
    "oa_ew": {
        "url": (
            "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services"
            "/Output_Areas_Dec_2021_Boundaries_EW_BGC_V2/FeatureServer/0"
        ),
        "code_field": "OA21CD",
        "name_field": "OA21CD",
        "description": "OA 2021 (England & Wales, generalised clipped)",
    },
    "lsoa_ew": {
        "url": (
            "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services"
            "/Lower_layer_Super_Output_Areas_Dec_2021_Boundaries_EW_BGC_V2/FeatureServer/0"
        ),
        "code_field": "LSOA21CD",
        "name_field": "LSOA21NM",
        "description": "LSOA 2021 (England & Wales, generalised clipped)",
    },
}

# ---------------------------------------------------------------------------
# Scottish OA / DZ boundaries
# ---------------------------------------------------------------------------
# NRS (National Records of Scotland) publish OA (called "Data Zones" at
# equivalent scale) via the Scottish Government's ArcGIS Online.
# 2011 DZ are the current census geography; 2022 census DZ are being published.
# Check https://spatialdata.gov.scot/ for the current service URL.

SCOTLAND_SERVICES = {
    "dz_scot": {
        "url": (
            "https://services2.arcgis.com/VZOdfqslH31uqXoN/arcgis/rest/services"
            "/Scottish_Data_Zone_Boundaries_2011/FeatureServer/0"
        ),
        "code_field": "DataZone",
        "name_field": "Name",
        "description": "Data Zones 2011 (Scotland) — OA-equivalent",
    },
}


def fetch_arcgis_geojson(service_url: str, out_path: Path, fields: str = "*") -> None:
    """
    Page through an ArcGIS FeatureServer and write all features to a GeoJSON file.
    Uses the /query endpoint with resultOffset pagination.
    """
    query_url = f"{service_url}/query"
    params = {
        "where": "1=1",
        "outFields": fields,
        "outSR": "4326",        # WGS84 — maplibre works in 4326
        "f": "geojson",
        "resultRecordCount": 2000,
        "resultOffset": 0,
    }

    features = []
    print(f"  Fetching {query_url} …", flush=True)

    while True:
        resp = requests.get(query_url, params=params, timeout=60)
        resp.raise_for_status()
        data = resp.json()

        batch = data.get("features", [])
        features.extend(batch)
        print(f"    …{len(features)} features", end="\r", flush=True)

        # ArcGIS signals "more records exist" via exceededTransferLimit
        if not data.get("exceededTransferLimit", False):
            break
        params["resultOffset"] += len(batch)

    print(f"    {len(features)} features total")

    fc = {"type": "FeatureCollection", "features": features}
    with open(out_path, "w") as f:
        json.dump(fc, f)
    print(f"  → {out_path} ({out_path.stat().st_size / 1e6:.1f} MB GeoJSON)")


def geojson_to_topojson(geojson_path: Path, topojson_path: Path, object_name: str) -> None:
    """Convert a GeoJSON file to quantised TopoJSON using the mapshaper CLI."""
    cmd = [
        "mapshaper",
        str(geojson_path),
        "-rename-layers", object_name,
        "-simplify", "10%", "keep-shapes",   # optional — remove for full-res
        "-o", str(topojson_path),
        "format=topojson", "quantization=1e5",
        "presimplify",
    ]
    print(f"  mapshaper → {topojson_path} …")
    try:
        subprocess.run(cmd, check=True, capture_output=True)
        size_mb = topojson_path.stat().st_size / 1e6
        print(f"  → {topojson_path} ({size_mb:.1f} MB TopoJSON)")
    except FileNotFoundError:
        print("  ERROR: mapshaper not found. Install with: npm install -g mapshaper")
        sys.exit(1)
    except subprocess.CalledProcessError as e:
        print(f"  ERROR: {e.stderr.decode()}")
        sys.exit(1)


def main() -> None:
    tmp_dir = OUTPUT_DIR / "_tmp"
    tmp_dir.mkdir(exist_ok=True)

    results = {}

    # --- OA (England & Wales) ------------------------------------------------
    print("\n=== OA 2021 — England & Wales ===")
    oa_ew_geojson = tmp_dir / "oa_ew.geojson"
    fetch_arcgis_geojson(
        ONS_SERVICES["oa_ew"]["url"],
        oa_ew_geojson,
        fields="OA21CD",
    )

    # --- LSOA (England & Wales) -----------------------------------------------
    print("\n=== LSOA 2021 — England & Wales ===")
    lsoa_ew_geojson = tmp_dir / "lsoa_ew.geojson"
    fetch_arcgis_geojson(
        ONS_SERVICES["lsoa_ew"]["url"],
        lsoa_ew_geojson,
        fields="LSOA21CD,LSOA21NM",
    )

    # --- Data Zones (Scotland) ------------------------------------------------
    print("\n=== Data Zones 2011 — Scotland ===")
    dz_scot_geojson = tmp_dir / "dz_scot.geojson"
    fetch_arcgis_geojson(
        SCOTLAND_SERVICES["dz_scot"]["url"],
        dz_scot_geojson,
        fields="DataZone,Name",
    )

    # --- Convert each to TopoJSON --------------------------------------------
    print("\n=== Converting to TopoJSON ===")

    oa_topo = OUTPUT_DIR / "gb-oa-generalised.topojson"
    lsoa_topo = OUTPUT_DIR / "gb-lsoa-generalised.topojson"

    # OA: combine E&W + Scotland (Data Zones)
    # For now, convert them separately — merge step can be added once both are
    # verified. Update App.tsx object name to "oa" or "dz" as appropriate.
    geojson_to_topojson(oa_ew_geojson, tmp_dir / "oa_ew.topojson", "oa")
    geojson_to_topojson(dz_scot_geojson, tmp_dir / "dz_scot.topojson", "dz")
    geojson_to_topojson(lsoa_ew_geojson, lsoa_topo, "lsoa")

    # Move OA E&W result to final path (Scotland merge is a later step)
    import shutil
    shutil.copy(tmp_dir / "oa_ew.topojson", oa_topo)

    results["OA (E&W)"] = oa_topo.stat().st_size / 1e6
    results["LSOA (E&W)"] = lsoa_topo.stat().st_size / 1e6

    # --- Summary -------------------------------------------------------------
    print("\n=== File size summary ===")
    for label, size_mb in results.items():
        recommendation = "✓ likely fine" if size_mb < 10 else "⚠ may be slow to load"
        print(f"  {label:20s} {size_mb:6.1f} MB  {recommendation}")

    print("""
Next steps:
  1. Check file sizes above.
  2. If OA ≤ 10 MB → keep OBJECT_NAME = 'oa', CODE_PROP = 'OA21CD' in src/App.tsx
     If OA > 10 MB  → switch to OBJECT_NAME = 'lsoa', CODE_PROP = 'LSOA21CD'
  3. Place the chosen file at public/data/gb-oa-generalised.topojson
     (rename if using LSOA: public/data/gb-lsoa-generalised.topojson → same path)
  4. Scotland Data Zones are in public/data/_tmp/dz_scot.topojson — merge later.
  5. npm run dev and verify the boundary layer loads correctly.
""")


if __name__ == "__main__":
    main()
