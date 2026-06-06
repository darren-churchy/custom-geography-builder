import { useState } from "react";

interface LabelPanelProps {
  labelGroups: Map<string, string[]>;
  activeLabel: string;
  onSetActive: (label: string) => void;
  onRelabel: (oldLabel: string, newLabel: string) => void;
  onClear: (label: string) => void;
}

export function LabelPanel({
  labelGroups,
  activeLabel,
  onSetActive,
  onRelabel,
  onClear,
}: LabelPanelProps) {
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  if (labelGroups.size === 0) {
    return (
      <section className="sidebar-section">
        <h2>Labels</h2>
        <p className="hint">
          No areas assigned yet. Enter a label name above, then click building
          blocks on the map.
        </p>
      </section>
    );
  }

  return (
    <section className="sidebar-section">
      <h2>
        Labels <span className="count">({labelGroups.size})</span>
      </h2>
      <ul className="label-list">
        {[...labelGroups.entries()].map(([label, codes]) => (
          <li
            key={label}
            className={`label-item ${label === activeLabel ? "active" : ""}`}
          >
            {editingLabel === label ? (
              <form
                className="label-edit-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const next = editValue.trim();
                  if (next) onRelabel(label, next);
                  setEditingLabel(null);
                }}
              >
                <input
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                />
                <button type="submit">Save</button>
                <button type="button" onClick={() => setEditingLabel(null)}>
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <button
                  className="label-name-btn"
                  onClick={() => onSetActive(label)}
                  title="Set as active label"
                >
                  <span className="label-dot" />
                  <span className="label-text">{label}</span>
                  <span className="label-count">({codes.length})</span>
                </button>
                <button
                  className="icon-btn"
                  onClick={() => {
                    setEditingLabel(label);
                    setEditValue(label);
                  }}
                  title="Rename label"
                >
                  ✎
                </button>
                <button
                  className="icon-btn danger"
                  onClick={() => onClear(label)}
                  title="Remove all blocks with this label"
                >
                  ✕
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
