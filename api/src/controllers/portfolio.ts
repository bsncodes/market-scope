import { parse } from 'csv-parse/sync';
import { malformedPayload, resourceValidationFailed } from '../errors';
import {
  blankToNull,
  normalizeHeader,
  parseCoordinate,
  recordIndexToLine,
} from '../helpers/csv';
import { replacePortfolio } from '../repositories/portfolio';
import {
  OPTIONAL_HEADERS,
  REQUIRED_HEADERS,
  type PortfolioRow,
  type RowError,
  type UploadResult,
} from '../types/portfolio';

const MAX_REPORTED_ERRORS = 50;

/**
 * Validation runs cheapest-first: parseability, then headers, then rows.
 * Row errors accumulate so a single attempt reports every problem, but any
 * error rejects the whole file — nothing is imported (cycles/02 §2.1).
 */
export function parsePortfolioCsv(buffer: Buffer): PortfolioRow[] {
  let records: Record<string, string>[];
  try {
    records = parse(buffer, {
      columns: (header: string[]) => header.map(normalizeHeader),
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
  } catch (err) {
    throw malformedPayload(
      `The file could not be parsed as CSV: ${(err as Error).message}`,
    );
  }

  if (records.length === 0) {
    throw resourceValidationFailed('The file contains no data rows.');
  }

  assertHeaders(records[0]);

  const errors: RowError[] = [];
  const rows = records.map((record, index) =>
    validateRow(record, recordIndexToLine(index), errors),
  );

  if (errors.length > 0) {
    const shown = errors.slice(0, MAX_REPORTED_ERRORS);
    throw resourceValidationFailed(
      `File rejected: ${errors.length} invalid row${errors.length > 1 ? 's' : ''}. No stores were imported.`,
      {
        error_count: errors.length,
        truncated: errors.length > shown.length,
        errors: shown,
      },
    );
  }

  return rows;
}

export async function replacePortfolioFromCsv(
  buffer: Buffer,
): Promise<UploadResult> {
  const rows = parsePortfolioCsv(buffer);
  const imported = await replacePortfolio(rows);
  const withCoordinates = rows.filter((r) => r.latitude !== null).length;

  return {
    imported,
    with_coordinates: withCoordinates,
    awaiting_geocoding: imported - withCoordinates,
  };
}

function assertHeaders(sample: Record<string, string>): void {
  const present = new Set(Object.keys(sample));
  const missing = REQUIRED_HEADERS.filter((header) => !present.has(header));

  if (missing.length > 0) {
    throw resourceValidationFailed(
      `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`,
      { missing, expected: [...REQUIRED_HEADERS, ...OPTIONAL_HEADERS] },
    );
  }
}

function validateRow(
  record: Record<string, string>,
  row: number,
  errors: RowError[],
): PortfolioRow {
  const storeName = blankToNull(record.store_name);
  if (storeName === null) {
    errors.push({
      row,
      column: 'store_name',
      message: 'store_name is required and cannot be empty.',
    });
  }

  const latitude = parseCoordinate(record.latitude, 'latitude', row, errors);
  const longitude = parseCoordinate(record.longitude, 'longitude', row, errors);

  const hasLat = blankToNull(record.latitude) !== null;
  const hasLng = blankToNull(record.longitude) !== null;
  if (hasLat !== hasLng) {
    errors.push({
      row,
      column: hasLat ? 'longitude' : 'latitude',
      message:
        'latitude and longitude must be provided together, or both left blank.',
    });
  }

  const address = blankToNull(record.address);
  // With no coordinates the row can only be placed by geocoding its address,
  // so a row with neither is permanently unusable.
  if (!hasLat && !hasLng && address === null) {
    errors.push({
      row,
      column: 'address',
      message:
        'address is required when latitude and longitude are not provided.',
    });
  }

  return {
    store_name: storeName ?? '',
    address,
    city: blankToNull(record.city),
    state: blankToNull(record.state),
    country: blankToNull(record.country),
    category: blankToNull(record.category),
    latitude,
    longitude,
  };
}
