# Custom Geography Builder — Project Context

## What this is

A static React/Vite single-page app for building custom regional geographies from
ONS boundary data. Users select building blocks on a MapLibre map, assign custom
labels, and export a dissolved shapefile + lookup CSV — entirely client-side, no
server required. Deployable to GitHub Pages.

## Commands

```bash
npm install
npm run dev       # http://localhost:5173/custom-geography-builder/
npm run build     # output to dist/
npm run preview   # serve dist/ locally
```

No test runner or linter configured. TypeScript strictness is enforced at build
time via `npm run build` (tsc + vite).

---

## Architecture

### Core pipeline (follows the data)

1. User picks an active label name and clicks building blocks on the map.
2. Each click writes `{ [code]: label }` into the flat `mapping` object.
3. On export, `dissolveByLabel` (in `src/core/dissolve-export-core.ts`) groups
   codes by label and calls `topojson.merge` — a topology-aware dissolve that
   cancels shared arcs, producing clean outer perimeters with no slivers.
   **Do NOT swap for turf.union.** TopoJSON topology is why this is fast.
4. `buildExportZip` wraps the result with `@mapbox/shp-write` + `JSZip` into a
   single download containing `.shp/.shx/.dbf/.prj`, `lookup.csv`,
   `ATTRIBUTION.txt`.
5. The whole dissolve + zip runs in a **Web Worker** (`src/workers/dissolve.worker.ts`)
   so the main thread stays responsive.

### State

All state lives in `src/App.tsx` + the `useSelections` hook:
- `topology: Topology | null` — the generalised display topology, fetched once
  from `public/data/gb-oa-generalised.topojson`.
- `activeLabel: string` — the label currently being painted.
- `mapping: Record<string, string>` — code → label. This IS the dissolve input
  and the lookup export. No separate "selection" state.

`useSelections` exposes `select`, `deselect`, `relabel`, `clearLabel`, and
`labelGroups` (a `Map<label, codes[]>` memoised from the mapping).

### Components

| Component | File | Purpose |
|---|---|---|
| `App` | `src/App.tsx` | State root; owns topology fetch; wires everything |
| `BoundaryMap` | `src/components/BoundaryMap.tsx` | MapLibre GL JS; click-to-select |
| `LabelPanel` | `src/components/LabelPanel.tsx` | Lists labels; rename/clear |
| `ExportButton` | `src/components/ExportButton.tsx` | Triggers Web Worker + download |

`BoundaryMap` uses a `useRef` to hold the latest `onBlockClick` callback, avoiding
stale-closure issues with MapLibre's event system.

### Boundary data (NOT in the repo — generate locally)

Place TopoJSON files in `public/data/` (excluded from git via `.gitignore`):

| File | Used for |
|---|---|
| `gb-oa-generalised.topojson` | Both display and export (Phase 0) |

Run `scripts/fetch-boundaries.py` to download and convert from the ONS Open
Geography Portal. The script fetches OA 2021 (E&W) and LSOA 2021 (E&W) and
reports file sizes to help decide the atomic unit. Requires:
- `pip install requests`
- `npm install -g mapshaper`

After generating, update the constants at the top of `src/App.tsx`:

```ts
const OBJECT_NAME = "oa";      // key inside topology.objects
const CODE_PROP   = "OA21CD";  // property on each geometry
```

If LSOA is chosen (because OA TopoJSON is > ~10 MB), change to `"lsoa"` /
`"LSOA21CD"`.

### Configuration constants (`src/App.tsx`)

| Constant | Default | Effect |
|---|---|---|
| `OBJECT_NAME` | `"oa"` | Key in `topology.objects` |
| `CODE_PROP` | `"OA21CD"` | Property holding the building-block code |
| `VINTAGE_YEAR` | `2021` | Stamped into exports and ATTRIBUTION.txt |
| `LAYER_NAME` | `"custom_regions"` | Shapefile layer name in the export zip |
| `CODE_COL` | `"OA21CD"` | Column header in lookup.csv |

---

## Licensing — enforced automatically in exports

Boundary data is OGL v3.0. `attributionText()` in
`src/core/dissolve-export-core.ts` generates the two mandatory strings and they
are embedded in every export zip as `ATTRIBUTION.txt`.

**Both lines are required for boundary products (OS-derived):**
1. `Source: Office for National Statistics licensed under the Open Government Licence v.3.0`
2. `Contains OS data © Crown copyright and database right [year]`

**Avoid postcode and UPRN products** — they carry Royal Mail / GeoPlace IP.
Northern Ireland "BT" postcodes need a separate LPS commercial licence. Sticking
to boundary products and statistical lookups keeps everything clean under OGL.

---

## Deployment

Push to `main` — GitHub Actions (`.github/workflows/deploy.yml`) builds and
deploys to GitHub Pages automatically. Enable Pages in repo Settings → Pages →
Source: GitHub Actions before the first push.

The `base` path in `vite.config.ts` must match the repository name exactly
(`custom-geography-builder`).

---

## Open decisions to revisit

- **OA vs LSOA**: benchmark file sizes with `scripts/fetch-boundaries.py`.
  Criterion: generalised TopoJSON ≤ 10 MB → OA; larger → LSOA.
- **Export CRS**: currently WGS84 (4326, what ONS API serves). Consider adding
  a BNG (EPSG:27700) option — most UK GIS users expect BNG in shapefiles. The
  `.prj` file in `buildExportZip` needs to match.
- **Scotland Data Zones**: `fetch-boundaries.py` downloads them separately.
  Full GB support requires merging them into one topology with consistent
  object/property names.
- **Full-res topology for export**: Phase 0 uses the generalised topology for
  both display and export. Phase 2 should lazy-load a full-resolution topology
  for export only (keeps download fast, gives clean export geometry).
- **National-scale dissolves**: if users select all GB OAs, the dissolve may
  take 30s–2min even in a Web Worker. Add a serverless fallback (Cloudflare
  Workers / Netlify function) only if this becomes a real use-case requirement.
