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
}
