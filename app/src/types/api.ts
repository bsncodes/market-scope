export interface Country {
  id: number;
  name: string;
  iso_code: string;
}

export interface State {
  id: number;
  name: string;
  code: string;
}

export interface City {
  id: number;
  name: string;
}

export interface Category {
  id: number;
  label: string;
}

export interface CityBbox {
  min_lat: number;
  min_lng: number;
  max_lat: number;
  max_lng: number;
}

export interface Bounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export interface UploadResult {
  imported: number;
  with_coordinates: number;
  awaiting_geocoding: number;
  reclassified_markets: number;
}

export interface PortfolioStoreRow {
  id: number;
  store_name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  category: string | null;
  lat: number | null;
  lng: number | null;
}

export interface PortfolioListResponse {
  count: number;
  limit: number;
  stores: PortfolioStoreRow[];
}

/** Per-row problems the upload endpoint reports in `error.details`. */
export interface RowError {
  row: number;
  column?: string;
  message: string;
}

export interface UploadErrorDetails {
  error_count?: number;
  truncated?: boolean;
  errors?: RowError[];
  missing?: string[];
  duplicated?: string[];
  expected?: string[];
}

export type MarketStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface DiscoveryProgress {
  tilesTotal: number;
  tilesFetched: number;
  tilesReused: number;
  tilesFailed: number;
  geocodeCandidates: number;
  geocodeResolved: number;
  geocodeUnresolved: number;
  geocodeFailed: number;
  discoveredInBoundary: number;
}

export interface MarketStatusResponse {
  market_id: number;
  status: MarketStatus;
  error: string | null;
  last_discovered_at: string | null;
  progress: DiscoveryProgress | null;
}

export interface MarketDetail extends MarketStatusResponse {
  boundary: Bounds;
  city: { id: number; name: string; state: string; country: string };
  categories: Category[];
}

export interface CreateMarketResponse {
  market_id: number;
  status: MarketStatus;
  area_sq_km: number;
}

export interface DiscoveredStore {
  id: string;
  name: string | null;
  category: string | null;
  lat: number;
  lng: number;
}

export interface DiscoveredStoresResponse {
  market_id: number;
  count: number;
  stores: DiscoveredStore[];
}

export interface PortfolioStore {
  id: number;
  name: string;
  category: string | null;
  address: string | null;
  is_inside: boolean;
  lat: number;
  lng: number;
}

export interface PortfolioResponse {
  market_id: number;
  inside_count: number;
  outside_count: number;
  stores: PortfolioStore[];
}

export interface MarketSummary {
  id: number;
  status: MarketStatus;
  error: string | null;
  created_at: string;
  last_discovered_at: string | null;
  area_sq_km: number;
  city: { id: number; name: string; state: string; country: string };
  categories: Category[];
  discovered_count: number | null;
  portfolio_inside: number;
  portfolio_outside: number;
}

export interface MarketListResponse {
  count: number;
  limit: number;
  markets: MarketSummary[];
}
