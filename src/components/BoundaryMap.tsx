import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { FeatureCollection } from "geojson";
import type { LabelMapping } from "../core/dissolve-export-core";

const COLOURS = [
  "#e63946", "#457b9d", "#2a9d8f", "#e9c46a", "#f4a261",
  "#264653", "#8338ec", "#fb5607", "#3a86ff", "#06d6a0",
];

interface BoundaryMapProps {
  topology: Topology | null;
  objectName: string;
  codeProp: string;
  mapping: LabelMapping;
  onBlockClick: (code: string) => void;
}

function makeColorExpr(mapping: LabelMapping, codeProp: string): unknown {
  if (Object.keys(mapping).length === 0) return "#ccc";
  const labelOrder: string[] = [];
  for (const label of Object.values(mapping)) {
    if (!labelOrder.includes(label)) labelOrder.push(label);
  }
  return [
    "match",
    ["get", codeProp],
    ...Object.entries(mapping).flatMap(([code, label]) => [
      code,
      COLOURS[labelOrder.indexOf(label) % COLOURS.length],
    ]),
    "#ccc",
  ];
}

export function BoundaryMap({
  topology,
  objectName,
  codeProp,
  mapping,
  onBlockClick,
}: BoundaryMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  // Keep a stable ref to the latest click handler to avoid stale closures.
  const onClickRef = useRef(onBlockClick);
  useEffect(() => {
    onClickRef.current = onBlockClick;
  }, [onBlockClick]);

  // Initialize MapLibre once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution:
              '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [-2.5, 54.0],
      zoom: 5.5,
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Add building-block source + layers when topology becomes available.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !topology) return;

    const geojson = feature(
      topology,
      topology.objects[objectName] as GeometryCollection
    ) as unknown as FeatureCollection;

    const setup = () => {
      if (map.getSource("blocks")) return; // already added

      map.addSource("blocks", { type: "geojson", data: geojson });
      map.addLayer({
        id: "blocks-fill",
        type: "fill",
        source: "blocks",
        paint: { "fill-color": "#ccc", "fill-opacity": 0.35 },
      });
      map.addLayer({
        id: "blocks-outline",
        type: "line",
        source: "blocks",
        paint: { "line-color": "#888", "line-width": 0.4, "line-opacity": 0.6 },
      });
      map.getCanvas().style.cursor = "pointer";
      map.on("click", "blocks-fill", (e) => {
        const code = e.features?.[0]?.properties?.[codeProp] as
          | string
          | undefined;
        if (code) onClickRef.current(code);
      });
    };

    if (map.isStyleLoaded()) setup();
    else map.once("load", setup);
  }, [topology, objectName, codeProp]);

  // Repaint fill colours whenever the mapping changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || !map.getLayer("blocks-fill")) return;
    map.setPaintProperty(
      "blocks-fill",
      "fill-color",
      makeColorExpr(mapping, codeProp) as string
    );
    map.setPaintProperty(
      "blocks-fill",
      "fill-opacity",
      Object.keys(mapping).length > 0 ? 0.5 : 0.35
    );
  }, [mapping, codeProp]);

  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map-canvas" />
      {!topology && (
        <div className="map-placeholder">
          <p>No boundary data loaded.</p>
          <p>
            Run <code>scripts/fetch-boundaries.py</code> then place the output in{" "}
            <code>public/data/</code>.
          </p>
        </div>
      )}
    </div>
  );
}
