import { useState, useCallback } from "react";
import type { Topology } from "topojson-specification";
import type { LabelMapping, ExportOptions } from "../core/dissolve-export-core";

interface ExportButtonProps {
  topology: Topology | null;
  mapping: LabelMapping;
  objectName: string;
  codeProp: string;
  vintageYear: number;
  layerName: string;
  codeColumnName: string;
}

interface WorkerResult {
  ok: boolean;
  blob?: Blob;
  error?: string;
}

export function ExportButton({
  topology,
  mapping,
  objectName,
  codeProp,
  vintageYear,
  layerName,
  codeColumnName,
}: ExportButtonProps) {
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");

  const handleExport = useCallback(() => {
    if (!topology || Object.keys(mapping).length === 0) return;

    setStatus("working");
    const worker = new Worker(
      new URL("../workers/dissolve.worker.ts", import.meta.url),
      { type: "module" }
    );

    worker.onmessage = (e: MessageEvent<WorkerResult>) => {
      worker.terminate();
      if (e.data.ok && e.data.blob) {
        const url = URL.createObjectURL(e.data.blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${layerName}_${vintageYear}.zip`;
        a.click();
        URL.revokeObjectURL(url);
        setStatus("idle");
      } else {
        console.error("Export failed:", e.data.error);
        setStatus("error");
      }
    };

    worker.onerror = (err) => {
      console.error("Worker error:", err);
      worker.terminate();
      setStatus("error");
    };

    const opts: ExportOptions = {
      objectName,
      codeProp,
      vintageYear,
      layerName,
      codeColumnName,
    };
    worker.postMessage({ topology, mapping, opts });
  }, [topology, mapping, objectName, codeProp, vintageYear, layerName, codeColumnName]);

  const selectionCount = Object.keys(mapping).length;
  const labelCount = new Set(Object.values(mapping)).size;
  const canExport = topology !== null && selectionCount > 0;

  return (
    <section className="sidebar-section export-section">
      <h2>Export</h2>
      {selectionCount > 0 && (
        <p className="hint">
          {selectionCount} block{selectionCount !== 1 ? "s" : ""} ·{" "}
          {labelCount} label{labelCount !== 1 ? "s" : ""}
        </p>
      )}
      <button
        className="export-btn"
        onClick={handleExport}
        disabled={!canExport || status === "working"}
      >
        {status === "working" ? "Exporting…" : "Download shapefile + lookup"}
      </button>
      {status === "error" && (
        <p className="error-msg">
          Export failed — check the browser console for details.
        </p>
      )}
      <p className="attribution-note">
        Exports include OGL v3.0 attribution automatically.
      </p>
    </section>
  );
}
