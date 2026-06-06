/**
 * dissolve-export-core.ts
 * -----------------------------------------------------------------------------
 * Reference implementation of the merge-and-export core for the Custom Geography
 * Builder. Framework-agnostic pure functions — call them from a component or,
 * for large jobs, from inside a Web Worker (see note at bottom).
 *
 * The geometry core (dissolveByLabel) is the load-bearing part and is correct as
 * written. The EXPORT wrappers near the bottom touch third-party libs whose APIs
 * have shifted between releases — those are marked "VERIFY against installed
 * version". Don't trust the exact signatures there without a quick check.
 *
 * Deps:
 *   npm i topojson-client @mapbox/shp-write jszip
 *   npm i -D @types/topojson-client @types/geojson
 * -----------------------------------------------------------------------------
 */

import { merge } from "topojson-client";
import type { Topology, GeometryObject, GeometryCollection } from "topojson-specification";
import type { Feature, FeatureCollection, MultiPolygon } from "geojson";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** Map of building-block code (e.g. an OA21CD) -> the user's custom region label. */
export type LabelMapping = Record<string, string>;

export interface DissolveOptions {
  /** Key in topology.objects to dissolve from, e.g. "oa". */
  objectName: string;
  /** Property on each geometry holding its building-block code, e.g. "OA21CD". */
  codeProp: string;
  /** Boundary vintage year — stamped into outputs for provenance. */
  vintageYear: number;
}

// -----------------------------------------------------------------------------
// 1. GEOMETRY CORE — dissolve building blocks into custom regions
// -----------------------------------------------------------------------------

/**
 * Dissolve a TopoJSON object's geometries into one MultiPolygon per custom label.
 *
 * Uses topojson.merge, which operates on the shared-arc TOPOLOGY: adjacent
 * building blocks with the same label have their shared boundary arcs cancelled
 * out, leaving a clean outer perimeter. This is why we ship TopoJSON rather than
 * GeoJSON — it's fast and avoids the slivers/artefacts you get from geometric
 * union (turf.union) over many polygons. Do NOT swap this for turf.union.
 *
 * Building blocks whose code is absent from `mapping` are simply ignored (they
 * weren't selected). One output Feature per distinct label.
 */
export function dissolveByLabel(
  topology: Topology,
  mapping: LabelMapping,
  opts: DissolveOptions
): FeatureCollection<MultiPolygon, { label: string; vintage: number }> {
  const obj = topology.objects[opts.objectName] as GeometryCollection;
  if (!obj || !("geometries" in obj)) {
    throw new Error(`TopoJSON object "${opts.objectName}" not found or not a GeometryCollection`);
  }

  // Group the topology geometry objects by their target label.
  const groups = new Map<string, GeometryObject[]>();
  for (const geom of obj.geometries) {
    const props = geom.properties as Record<string, unknown> | undefined;
    const code = props?.[opts.codeProp] as string | undefined;
    if (!code) continue;
    const label = mapping[code];
    if (!label) continue; // not selected by the user
    const bucket = groups.get(label) ?? [];
    bucket.push(geom);
    groups.set(label, bucket);
  }

  // Merge each group's arcs into a single MultiPolygon.
  const features: Feature<MultiPolygon, { label: string; vintage: number }>[] = [];
  for (const [label, geometries] of groups) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const multipolygon = merge(topology, geometries as any) as MultiPolygon;
    features.push({
      type: "Feature",
      geometry: multipolygon,
      properties: { label, vintage: opts.vintageYear },
    });
  }

  return { type: "FeatureCollection", features };
}

// -----------------------------------------------------------------------------
// 2. LOOKUP EXPORT — the join table that DEFINED the dissolve
// -----------------------------------------------------------------------------

/**
 * The lookup is the same information that drove the dissolve, surfaced as a flat
 * table. This is what users feed into their own R / Python / GIS pipelines.
 * Columns: building_block_code, custom_label, vintage_year.
 */
export function buildLookupCsv(
  mapping: LabelMapping,
  codeColumnName: string,
  vintageYear: number
): string {
  const header = `${codeColumnName},custom_label,vintage_year`;
  const rows = Object.entries(mapping).map(
    ([code, label]) => `${code},${csvEscape(label)},${vintageYear}`
  );
  return [header, ...rows].join("\n") + "\n";
}

function csvEscape(value: string): string {
  // Quote if the value contains comma, quote, or newline; double any quotes.
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

// -----------------------------------------------------------------------------
// 3. ATTRIBUTION — OGL v3.0 compliance, embedded so users stay compliant
// -----------------------------------------------------------------------------

/**
 * Returns the mandatory attribution block. Boundary products are OS-derived, so
 * BOTH the ONS source line AND the OS Crown copyright line are required. Write
 * this into the export zip (ATTRIBUTION.txt) and surface it in the UI.
 */
export function attributionText(vintageYear: number): string {
  return [
    `Source: Office for National Statistics licensed under the Open Government Licence v.3.0`,
    `Contains OS data © Crown copyright and database right ${vintageYear}`,
    ``,
    `Custom geography produced with Custom Geography Builder.`,
    `Boundary vintage: ${vintageYear}.`,
  ].join("\n");
}

// -----------------------------------------------------------------------------
// 4. PACKAGING — assemble shapefile + lookup + attribution into one zip
// -----------------------------------------------------------------------------
//
// NOTE / VERIFY: @mapbox/shp-write's API has changed across releases. Depending
// on the installed version, `zip()` may return a base64 string, a Blob, an
// ArrayBuffer, or a Promise of one of those. Check what your version actually
// returns and adjust the `await`/decoding below. The shape of the GeoJSON input
// (FeatureCollection of MultiPolygon) is the stable part.
//
// Because shp-write produces its OWN zip, the cleanest way to also bundle the
// lookup CSV and attribution is to generate the shapefile components and then
// repackage everything into a single JSZip ourselves. Two viable paths:
//   (a) Simple: ship two downloads — shp-write's zip, plus a separate zip with
//       lookup.csv + ATTRIBUTION.txt. Less tidy but trivially robust.
//   (b) Tidy (below): get shapefile bytes, drop them into one combined zip.
// -----------------------------------------------------------------------------

import JSZip from "jszip";
// eslint-disable-next-line @typescript-eslint/no-var-requires
import * as shpwrite from "@mapbox/shp-write";

export interface ExportOptions extends DissolveOptions {
  /** Filename stem for the shapefile layer, e.g. "custom_regions". */
  layerName: string;
  /** Column name to use for the building-block code in the lookup CSV. */
  codeColumnName: string;
}

/**
 * Build the full export as a single zipped Blob containing:
 *   - <layerName>.shp/.shx/.dbf/.prj   (the dissolved custom regions)
 *   - lookup.csv                        (building block -> label)
 *   - ATTRIBUTION.txt                   (OGL compliance)
 *
 * Returns a Blob ready to hand to a download helper (e.g. file-saver).
 */
export async function buildExportZip(
  topology: Topology,
  mapping: LabelMapping,
  opts: ExportOptions
): Promise<Blob> {
  const fc = dissolveByLabel(topology, mapping, opts);

  // --- shapefile bytes -------------------------------------------------------
  // VERIFY signature against installed @mapbox/shp-write version.
  // Recent versions: shpwrite.zip(geojson, { outputType: "arraybuffer", ... })
  const shpZipBytes: ArrayBuffer = await Promise.resolve(
    (shpwrite as any).zip(fc, {
      outputType: "arraybuffer",
      types: { polygon: opts.layerName }, // MultiPolygon writes as polygon shapefile
      // prj content: BNG (EPSG:27700) or WGS84 (EPSG:4326) — see CLAUDE.md open Q.
    })
  );

  // --- repackage everything into one combined zip ----------------------------
  // Unpack shp-write's zip and re-add its entries so we end up with a single,
  // tidy archive that also carries the lookup + attribution.
  const combined = new JSZip();
  const inner = await JSZip.loadAsync(shpZipBytes);
  await Promise.all(
    Object.keys(inner.files).map(async (name) => {
      const bytes = await inner.files[name].async("uint8array");
      combined.file(name, bytes);
    })
  );

  combined.file("lookup.csv", buildLookupCsv(mapping, opts.codeColumnName, opts.vintageYear));
  combined.file("ATTRIBUTION.txt", attributionText(opts.vintageYear));

  return combined.generateAsync({ type: "blob" });
}

// -----------------------------------------------------------------------------
// Web Worker note
// -----------------------------------------------------------------------------
// For large (e.g. national OA) dissolves, run dissolveByLabel / buildExportZip
// inside a Web Worker so the main thread stays responsive. Post the topology +
// mapping in, post the Blob back out. Keep the *full-resolution* topology in the
// worker and use a *generalised* copy on the map thread for display only.
//
// Minimal worker shell:
//   self.onmessage = async (e) => {
//     const { topology, mapping, opts } = e.data;
//     const blob = await buildExportZip(topology, mapping, opts);
//     self.postMessage(blob); // structured-clone handles Blob
//   };
