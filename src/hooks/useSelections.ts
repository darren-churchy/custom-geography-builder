import { useState, useCallback, useMemo } from "react";
import type { LabelMapping } from "../core/dissolve-export-core";

export function useSelections() {
  const [mapping, setMapping] = useState<LabelMapping>({});

  const select = useCallback((code: string, label: string) => {
    setMapping((prev) => ({ ...prev, [code]: label }));
  }, []);

  const deselect = useCallback((code: string) => {
    setMapping((prev) => {
      const next = { ...prev };
      delete next[code];
      return next;
    });
  }, []);

  const relabel = useCallback((oldLabel: string, newLabel: string) => {
    setMapping((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([code, label]) => [
          code,
          label === oldLabel ? newLabel : label,
        ])
      )
    );
  }, []);

  const clearLabel = useCallback((label: string) => {
    setMapping((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([, l]) => l !== label))
    );
  }, []);

  // label → [codes] — used by LabelPanel
  const labelGroups = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const [code, label] of Object.entries(mapping)) {
      const bucket = groups.get(label) ?? [];
      bucket.push(code);
      groups.set(label, bucket);
    }
    return groups;
  }, [mapping]);

  return { mapping, select, deselect, relabel, clearLabel, labelGroups };
}
