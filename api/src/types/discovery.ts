export interface Bbox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export interface DiscoveredStore {
  osmElementId: string;
  name: string | null;
  categoryValue: string;
  lat: number;
  lng: number;
}

/** One OSM tag expression from category.value, e.g. `amenity=pharmacy`. */
export interface OsmTag {
  key: string;
  value: string;
}

export interface CategoryTags {
  categoryId: number;
  label: string;
  tags: OsmTag[];
}

export interface DiscoveryJobData {
  marketId: number;
}

export interface TileFailure {
  tileKey: string;
  categoryId: number;
  reason: string;
}

export interface DiscoveryProgress {
  tilesTotal: number;
  tilesFetched: number;
  tilesReused: number;
  tilesFailed: number;

  // Geocoding gets its own counters so a geocoder outage is visible rather
  // than indistinguishable from a portfolio with no matching stores.
  // `Unresolved` is the expected per-row outcome for a bad address;
  // `Failed` means the call itself errored, which points at the service.
  geocodeCandidates: number;
  geocodeResolved: number;
  geocodeUnresolved: number;
  geocodeFailed: number;

  // Computed once here rather than recomputed by every dashboard read.
  discoveredInBoundary: number;
}

export const emptyProgress = (): DiscoveryProgress => ({
  tilesTotal: 0,
  tilesFetched: 0,
  tilesReused: 0,
  tilesFailed: 0,
  geocodeCandidates: 0,
  geocodeResolved: 0,
  geocodeUnresolved: 0,
  geocodeFailed: 0,
  discoveredInBoundary: 0,
});
