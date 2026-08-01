import { config } from '../config';
import {
  resourceNotFound,
  upstreamNoResult,
  upstreamServiceFailed,
} from '../errors';
import { HttpError, http } from '../http';
import { findCityForGeocoding, saveCityBbox } from '../repositories/location';
import type { CityBbox } from '../types/location';

// Nominatim's usage policy requires a User-Agent identifying the application.
const USER_AGENT = 'MarketScope/1.0 (take-home project)';

interface NominatimResult {
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
  const bbox = await fetchBboxFromNominatim(query);
  await saveCityBbox(cityId, bbox);
  return bbox;
}

async function fetchBboxFromNominatim(query: string): Promise<CityBbox> {
  let results: NominatimResult[];
  try {
    results = await http.get<NominatimResult[]>('/search', {
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

  return { min_lat: south, min_lng: west, max_lat: north, max_lng: east };
}
