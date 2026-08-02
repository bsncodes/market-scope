import { useEffect, useState } from 'react';
import { normalizeBounds } from '../lib/boundary';
import type { Bounds } from '../types/api';

const EDGES = [
  { key: 'minLat', label: 'South', hint: 'Bottom edge, °N' },
  { key: 'maxLat', label: 'North', hint: 'Top edge, °N' },
  { key: 'minLng', label: 'West', hint: 'Left edge, °E' },
  { key: 'maxLng', label: 'East', hint: 'Right edge, °E' },
] as const;

/**
 * A keyboard path to the same boundary the map drags.
 *
 * The Leaflet handles are pointer-only: they are non-focusable `divIcon`
 * spans, and sizing the market is the one interaction the whole flow turns on.
 * Rather than reimplement dragging for the keyboard, this exposes the four
 * edges directly — which is also the only way to enter an exact boundary.
 *
 * Edits are held as text while typing, because committing on every keystroke
 * makes a half-typed "12." collapse the rectangle under the caret.
 */
export function BoundaryFields({
  bounds,
  onChange,
}: {
  bounds: Bounds;
  onChange: (bounds: Bounds) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});

  // Dragging the map is the other author of these values; drop any draft that
  // the map has since overwritten so the fields never show a stale number.
  useEffect(() => setDraft({}), [bounds]);

  const commit = (key: keyof Bounds, raw: string) => {
    const value = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(value)) {
      setDraft((d) => ({ ...d, [key]: '' }));
      return;
    }
    onChange(normalizeBounds({ ...bounds, [key]: value }));
  };

  return (
    <fieldset className="boundary-fields">
      <legend className="field__label">Boundary edges</legend>
      {EDGES.map(({ key, label, hint }) => (
        <label key={key} className="boundary-fields__field">
          <span className="boundary-fields__label">{label}</span>
          <input
            className="field__control"
            type="number"
            step="0.001"
            inputMode="decimal"
            aria-label={`${label} — ${hint}`}
            value={draft[key] ?? bounds[key].toFixed(5)}
            onChange={(event) =>
              setDraft((d) => ({ ...d, [key]: event.target.value }))
            }
            onBlur={(event) => commit(key, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commit(key, event.currentTarget.value);
              }
            }}
          />
        </label>
      ))}
      <p className="footnote">
        Type a value and press Enter, or drag the handles on the map.
      </p>
    </fieldset>
  );
}
