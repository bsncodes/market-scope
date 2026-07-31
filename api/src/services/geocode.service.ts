import { config } from '../config';
import { badGateway, notFound } from '../errors';
import {
  findCityForGeocoding,
  saveCityBbox,
} from '../repositories/reference.repo';
import type { CityBbox } from '../types/reference.types';

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
    throw notFound('city_not_found', `No city with id ${cityId}.`);
  }

  if (city.bbox) return city.bbox;

  const query = [city.name, city.state_name, city.country_name].join(', ');
  const bbox = await fetchBboxFromNominatim(query);
  await saveCityBbox(cityId, bbox);
  return bbox;
}

async function fetchBboxFromNominatim(query: string): Promise<CityBbox> {
  const url = new URL('/search', config.nominatimBaseUrl);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');

  let response: Response;
  try {
    response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  } catch (err) {
    throw badGateway(
      'geocoding_unreachable',
      `Could not reach the geocoding service: ${(err as Error).message}`,
    );
  }

  if (!response.ok) {
    throw badGateway(
      'geocoding_failed',
      `Geocoding service returned ${response.status}.`,
    );
  }

  const results = (await response.json()) as NominatimResult[];
  const box = results[0]?.boundingbox;
  if (!box) {
    throw notFound(
      'geocoding_no_result',
      `No geocoding result for "${query}".`,
    );
  }

  const [south, north, west, east] = box.map(Number);
  if (![south, north, west, east].every(Number.isFinite)) {
    throw badGateway(
      'geocoding_malformed',
      `Geocoding service returned an unparseable bounding box for "${query}".`,
    );
  }

  return { min_lat: south, min_lng: west, max_lat: north, max_lng: east };
}
