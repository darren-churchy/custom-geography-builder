import { useState, useEffect, useCallback } from "react";
import type { Topology } from "topojson-specification";
import { BoundaryMap } from "./components/BoundaryMap";
import { LabelPanel } from "./components/LabelPanel";
import { ExportButton } from "./components/ExportButton";
import { useSelections } from "./hooks/useSelections";
import "./index.css";

// Boundary configuration — matches what fetch-boundaries-ci.py produces.
// To switch to OA granularity, run scripts/fetch-boundaries.py locally and
// update these to: OBJECT_NAME="oa", CODE_PROP/CODE_COL="OA21CD".
const OBJECT_NAME = "lsoa";
const CODE_PROP   = "LSOA21CD";
const VINTAGE_YEAR = 2021;
const LAYER_NAME  = "custom_regions";
const CODE_COL    = "LSOA21CD";

export default function App() {
  const [topology, setTopology] = useState<Topology | null>(null);
  const [activeLabel, setActiveLabel] = useState("Region 1");
  const { mapping, select, deselect, relabel, clearLabel, labelGroups } =
    useSelections();

  // Fetch generalised display topology (lazy — not bundled into JS).
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/boundaries.topojson`)
      .then((r) =>
        r.ok ? (r.json() as Promise<Topology>) : Promise.reject(r.status)
      )
      .then(setTopology)
      .catch((e: unknown) =>
        console.info(
          "Boundary data not yet present — run scripts/fetch-boundaries.py:",
          e
        )
      );
  }, []);

  const handleBlockClick = useCallback(
    (code: string) => {
      // Toggle: clicking a block already on the active label deselects it.
      if (mapping[code] === activeLabel) {
        deselect(code);
      } else {
        select(code, activeLabel);
      }
    },
    [activeLabel, mapping, select, deselect]
  );

  const handleRelabel = useCallback(
    (oldLabel: string, newLabel: string) => {
      relabel(oldLabel, newLabel);
      if (activeLabel === oldLabel) setActiveLabel(newLabel);
    },
    [activeLabel, relabel]
  );

  return (
    <div className="app-layout">
      <header className="app-header">
        <h1>Custom Geography Builder</h1>
        <span className="vintage-badge">ONS boundaries {VINTAGE_YEAR}</span>
      </header>
      <div className="app-body">
        <div className="map-container">
          <BoundaryMap
            topology={topology}
            objectName={OBJECT_NAME}
            codeProp={CODE_PROP}
            mapping={mapping}
            onBlockClick={handleBlockClick}
          />
        </div>
        <aside className="sidebar">
          <section className="sidebar-section">
            <h2>Active label</h2>
            <input
              type="text"
              className="label-input"
              value={activeLabel}
              onChange={(e) => setActiveLabel(e.target.value)}
              placeholder="e.g. North West"
            />
            <p className="hint">
              Click building blocks on the map to assign them this label.
            </p>
          </section>
          <LabelPanel
            labelGroups={labelGroups}
            activeLabel={activeLabel}
            onSetActive={setActiveLabel}
            onRelabel={handleRelabel}
            onClear={clearLabel}
          />
          <ExportButton
            topology={topology}
            mapping={mapping}
            objectName={OBJECT_NAME}
            codeProp={CODE_PROP}
            vintageYear={VINTAGE_YEAR}
            layerName={LAYER_NAME}
            codeColumnName={CODE_COL}
          />
        </aside>
      </div>
    </div>
  );
}
