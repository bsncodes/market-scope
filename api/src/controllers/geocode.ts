import { config } from '../config';
import {
  resourceNotFound,
  upstreamNoResult,
  upstreamServiceFailed,
} from '../errors';
import { RateLimiter } from '../helpers/rateLimiter';
import { HttpError, http } from '../http';
import { findCachedGeocode, saveGeocode } from '../repositories/discovery';
import { findCityForGeocoding, saveCityBbox } from '../repositories/location';
import type { CityBbox } from '../types/location';

// Nominatim's usage policy requires a User-Agent identifying the application.
const USER_AGENT = 'MarketScope/1.0 (take-home project)';

// Nominatim allows roughly one request per second. The worker geocodes
// portfolio rows in a loop, so every call goes through one shared limiter.
const limiter = new RateLimiter(
  config.nominatimRatePerSecond,
  config.nominatimBurst,
);

interface NominatimResult {
  lat?: string;
  lon?: string;
  // [south, north, west, east] as strings — note this is NOT min/max lat/lng
  // order, and getting it wrong yields a valid-looking but transposed box.
  boundingbox?: [string, string, string, string];
}

/**
 * Returns the city's bounding box, geocoding it only on a miss. The result is
 * written back onto the city row, so the second call for a given city makes no
 * external request (cycles/02 §2.2).
 */
export async function getCityBbox(cityId: number): Promise<CityBbox> {
  const city = await findCityForGeocoding(cityId);
  if (!city) {
    throw resourceNotFound(`No city with id ${cityId}.`);
  }

  if (city.bbox) return city.bbox;

  const query = [city.name, city.state_name, city.country_name].join(', ');
  const results = await searchNominatim(query);

  const box = results[0]?.boundingbox;
  if (!box) {
    throw upstreamNoResult(`No geocoding result for "${query}".`);
  }

  const [south, north, west, east] = box.map(Number);
  if (![south, north, west, east].every(Number.isFinite)) {
    throw upstreamServiceFailed(
      `Geocoding service returned an unparseable bounding box for "${query}".`,
    );
  }

  const bbox = { min_lat: south, min_lng: west, max_lat: north, max_lng: east };
  await saveCityBbox(cityId, bbox);
  return bbox;
}

export function normalizeAddress(parts: (string | null)[]): string {
  return parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(', ')
    .toLowerCase()
    .replace(/[^a-z0-9, ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolves a portfolio address to a point, consulting geocode_cache first.
 * That table is immutable and never expires (§3.1): an address's coordinates
 * do not change, so a hit needs no freshness check and costs nothing.
 *
 * Returns null when the address simply cannot be resolved, which is a normal
 * outcome for user-supplied data rather than a failure.
 */
export async function geocodeAddress(
  parts: (string | null)[],
): Promise<{ lat: number; lng: number } | null> {
  const normalized = normalizeAddress(parts);
  if (!normalized) return null;

  const cached = await findCachedGeocode(normalized);
  if (cached) return cached;

  const results = await searchNominatim(normalized);
  const first = results[0];
  if (!first?.lat || !first?.lon) return null;

  const lat = Number(first.lat);
  const lng = Number(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  await saveGeocode(normalized, lat, lng);
  return { lat, lng };
}

async function searchNominatim(query: string): Promise<NominatimResult[]> {
  return limiter.schedule(async () => {
    try {
      return await http.get<NominatimResult[]>('/search', {
        baseUrl: config.nominatimBaseUrl,
        params: { q: query, format: 'json', limit: 1 },
        headers: { 'User-Agent': USER_AGENT },
      });
    } catch (err) {
      if (err instanceof HttpError) {
        // A null status means the request never reached the service at all,
        // which reads differently from a bad response.
        const cause =
          err.status === null
            ? 'could not be reached'
            : `responded with ${err.status}`;
        throw upstreamServiceFailed(`The geocoding service ${cause}.`);
      }
      throw err;
    }
  });
}
