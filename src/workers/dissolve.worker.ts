// Runs in a DedicatedWorker — receives a topology + mapping, returns a Blob.
import type { Topology } from "topojson-specification";
import type { LabelMapping, ExportOptions } from "../core/dissolve-export-core";
import { buildExportZip } from "../core/dissolve-export-core";

interface WorkerInput {
  topology: Topology;
  mapping: LabelMapping;
  opts: ExportOptions;
}

interface WorkerOutput {
  ok: boolean;
  blob?: Blob;
  error?: string;
}

// self is DedicatedWorkerGlobalScope at runtime; cast to avoid needing the
// webworker lib (which conflicts with the DOM lib in tsconfig.app.json).
interface WorkerContext {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(data: unknown): void;
}
const ctx = self as unknown as WorkerContext;

ctx.onmessage = async (e: MessageEvent<WorkerInput>) => {
  const { topology, mapping, opts } = e.data;
  try {
    const blob = await buildExportZip(topology, mapping, opts);
    ctx.postMessage({ ok: true, blob } satisfies WorkerOutput);
  } catch (err) {
    ctx.postMessage({ ok: false, error: String(err) } satisfies WorkerOutput);
  }
};
