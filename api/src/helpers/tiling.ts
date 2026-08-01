import type { Bbox } from '../types/discovery';

// One degree of latitude is ~110.574 km everywhere. Longitude degrees shrink
// toward the poles, so a fixed-degree cell is slightly narrower in km at higher
// latitudes — across India (8°N to 37°N) that is a 1% to 20% variation, which
// only changes how much ground one fetch covers, never correctness.
const KM_PER_DEGREE_LAT = 110.574;

// A drawn boundary is capped at 30 sq km, so a 1 km grid yields tens of tiles.
// Anything near this ceiling means the cap or the tile size is misconfigured.
const MAX_TILES_PER_MARKET = 2000;

export function tileStepDegrees(tileSizeKm: number): number {
  if (!(tileSizeKm > 0)) {
    throw new Error(`tileSizeKm must be positive, got ${tileSizeKm}`);
  }
  return tileSizeKm / KM_PER_DEGREE_LAT;
}

/**
 * Grid cells are identified by their integer indices rather than a geohash:
 * Overpass queries by bounding box, and this key converts back to one exactly,
 * at whatever size TILE_SIZE_KM specifies. Geohash precision comes in fixed
 * steps that cannot be tuned to a configured size.
 */
export function tileKeyAt(lat: number, lng: number, step: number): string {
  return `${Math.floor(lat / step)}:${Math.floor(lng / step)}`;
}

export function tileKeyToBbox(key: string, step: number): Bbox {
  // Split before converting: Number('') is 0, so an empty segment would
  // otherwise pass an Number.isInteger check and silently become tile 0.
  const parts = key.split(':');
  if (parts.length !== 2 || parts.some((part) => part.trim() === '')) {
    throw new Error(`Malformed tile key: "${key}"`);
  }

  const [latIndex, lngIndex] = parts.map(Number);
  if (!Number.isInteger(latIndex) || !Number.isInteger(lngIndex)) {
    throw new Error(`Malformed tile key: "${key}"`);
  }
  return {
    minLat: latIndex * step,
    minLng: lngIndex * step,
    maxLat: (latIndex + 1) * step,
    maxLng: (lngIndex + 1) * step,
  };
}

/**
 * Every tile the bounds touch. Tiles are coarser than the drawn boundary, so
 * this is deliberately over-inclusive — the exact shape is enforced later by
 * clipping with ST_Contains, and an extra tile only costs a wider fetch whose
 * results stay cached for neighbouring markets.
 */
export function tileKeysForBbox(bounds: Bbox, step: number): string[] {
  const latStart = Math.floor(bounds.minLat / step);
  const latEnd = Math.floor(bounds.maxLat / step);
  const lngStart = Math.floor(bounds.minLng / step);
  const lngEnd = Math.floor(bounds.maxLng / step);

  const total = (latEnd - latStart + 1) * (lngEnd - lngStart + 1);
  if (total > MAX_TILES_PER_MARKET) {
    throw new Error(
      `Boundary decomposes into ${total} tiles, above the ${MAX_TILES_PER_MARKET} limit.`,
    );
  }

  const keys: string[] = [];
  for (let latIndex = latStart; latIndex <= latEnd; latIndex += 1) {
    for (let lngIndex = lngStart; lngIndex <= lngEnd; lngIndex += 1) {
      keys.push(`${latIndex}:${lngIndex}`);
    }
  }
  return keys;
}
