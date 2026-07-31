import type { CoordinateColumn, RowError } from '../types/portfolio';

const COORDINATE_LIMITS: Record<CoordinateColumn, number> = {
  latitude: 90,
  longitude: 180,
};

export function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, '_');
}

export function blankToNull(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Returns the parsed coordinate, or null when absent or invalid. Invalid
 * values push onto `errors` rather than throwing, so one pass reports every
 * problem in the file instead of only the first.
 */
export function parseCoordinate(
  raw: string | undefined,
  column: CoordinateColumn,
  row: number,
  errors: RowError[],
): number | null {
  const value = blankToNull(raw);
  if (value === null) return null;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    errors.push({
      row,
      column,
      message: `${column} must be a number, got "${value}".`,
    });
    return null;
  }

  const limit = COORDINATE_LIMITS[column];
  if (parsed < -limit || parsed > limit) {
    errors.push({
      row,
      column,
      message: `${column} must be between -${limit} and ${limit}, got ${parsed}.`,
    });
    return null;
  }

  return parsed;
}

// +2 maps a zero-based record index onto the line number the user sees:
// 1-based, and offset past the header row.
export function recordIndexToLine(index: number): number {
  return index + 2;
}
