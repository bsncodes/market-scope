import area from '@turf/area';
import type { Bounds, CityBbox } from '../types/api';

/** Mirrors the server-side cap in config.marketMaxAreaSqKm. */
export const MAX_AREA_SQ_KM = 30;

export const fromCityBbox = (bbox: CityBbox): Bounds => ({
  minLat: bbox.min_lat,
  minLng: bbox.min_lng,
  maxLat: bbox.max_lat,
  maxLng: bbox.max_lng,
});

/**
 * Real geodesic area, not width × height in degrees: a degree of longitude is
 * ~111 km at the equator and ~85 km at Delhi's latitude, so the naive product
 * would disagree with the server's ST_Area and let the user submit a boundary
 * the API then rejects.
 */
export function areaSqKm(bounds: Bounds): number {
  const { minLat, minLng, maxLat, maxLng } = bounds;
  return (
    area({
      type: 'Polygon',
      coordinates: [
        [
          [minLng, minLat],
          [minLng, maxLat],
          [maxLng, maxLat],
          [maxLng, minLat],
          [minLng, minLat],
        ],
      ],
    }) / 1_000_000
  );
}

const MIN_SPAN_DEGREES = 0.0005;

/**
 * Keeps a rectangle non-degenerate however its corners were dragged. The API
 * rejects an inverted or zero-width box, and a collapsed one is impossible to
 * grab again with a mouse.
 */
export function normalizeBounds(bounds: Bounds): Bounds {
  const minLat = Math.min(bounds.minLat, bounds.maxLat);
  const maxLat = Math.max(bounds.minLat, bounds.maxLat);
  const minLng = Math.min(bounds.minLng, bounds.maxLng);
  const maxLng = Math.max(bounds.minLng, bounds.maxLng);

  return {
    minLat,
    minLng,
    maxLat: Math.max(maxLat, minLat + MIN_SPAN_DEGREES),
    maxLng: Math.max(maxLng, minLng + MIN_SPAN_DEGREES),
  };
}

/**
 * A city's own bbox is almost always far larger than the 30 sq km cap, so the
 * user would land on a boundary they cannot submit. Shrinking it around the
 * centre gives them a valid starting rectangle they can grow.
 */
export function shrinkToLimit(bounds: Bounds): Bounds {
  const current = areaSqKm(bounds);
  if (current <= MAX_AREA_SQ_KM) return bounds;

  // Area scales with the square of a linear scale factor. The 0.98 leaves a
  // margin so floating-point drift cannot land fractionally over the cap.
  const scale = Math.sqrt(MAX_AREA_SQ_KM / current) * 0.98;
  const centreLat = (bounds.minLat + bounds.maxLat) / 2;
  const centreLng = (bounds.minLng + bounds.maxLng) / 2;
  const halfLat = ((bounds.maxLat - bounds.minLat) / 2) * scale;
  const halfLng = ((bounds.maxLng - bounds.minLng) / 2) * scale;

  return {
    minLat: centreLat - halfLat,
    minLng: centreLng - halfLng,
    maxLat: centreLat + halfLat,
    maxLng: centreLng + halfLng,
  };
}

export const boundsCentre = (b: Bounds): [number, number] => [
  (b.minLat + b.maxLat) / 2,
  (b.minLng + b.maxLng) / 2,
];
