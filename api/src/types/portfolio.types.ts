export const REQUIRED_HEADERS = [
  'store_name',
  'address',
  'city',
  'state',
  'country',
  'category',
] as const;

export const OPTIONAL_HEADERS = ['latitude', 'longitude'] as const;

export type CoordinateColumn = 'latitude' | 'longitude';

export interface PortfolioRow {
  store_name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  category: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface RowError {
  row: number;
  column?: string;
  message: string;
}

export interface UploadResult {
  imported: number;
  with_coordinates: number;
  awaiting_geocoding: number;
}
