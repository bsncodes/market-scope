import { pool } from '../db';
import type {
  Category,
  City,
  CityBbox,
  CityForGeocoding,
  Country,
  State,
} from '../types/reference.types';

export async function listCountries(): Promise<Country[]> {
  const { rows } = await pool.query<Country>(
    'SELECT id, name, iso_code FROM country ORDER BY name',
  );
  return rows;
}

export async function listStates(countryId: number): Promise<State[]> {
  const { rows } = await pool.query<State>(
    'SELECT id, name, code FROM state WHERE country_id = $1 ORDER BY name',
    [countryId],
  );
  return rows;
}

export async function listCities(stateId: number): Promise<City[]> {
  const { rows } = await pool.query<City>(
    'SELECT id, name FROM city WHERE state_id = $1 ORDER BY name',
    [stateId],
  );
  return rows;
}

// `value` holds the OSM tag expressions used by discovery and is deliberately
// not exposed to clients.
export async function listCategories(): Promise<Category[]> {
  const { rows } = await pool.query<Category>(
    'SELECT id, label FROM category ORDER BY label',
  );
  return rows;
}

export async function findCityForGeocoding(
  cityId: number,
): Promise<CityForGeocoding | null> {
  const { rows } = await pool.query(
    `SELECT c.id, c.name, s.name AS state_name, co.name AS country_name,
            c.min_lat, c.min_lng, c.max_lat, c.max_lng
     FROM city c
     JOIN state s ON s.id = c.state_id
     JOIN country co ON co.id = s.country_id
     WHERE c.id = $1`,
    [cityId],
  );
  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    id: row.id,
    name: row.name,
    state_name: row.state_name,
    country_name: row.country_name,
    bbox:
      row.min_lat === null
        ? null
        : {
            min_lat: row.min_lat,
            min_lng: row.min_lng,
            max_lat: row.max_lat,
            max_lng: row.max_lng,
          },
  };
}

// All four columns move together: city_bbox_all_or_none rejects a partial write.
export async function saveCityBbox(
  cityId: number,
  bbox: CityBbox,
): Promise<void> {
  await pool.query(
    `UPDATE city
     SET min_lat = $2, min_lng = $3, max_lat = $4, max_lng = $5
     WHERE id = $1`,
    [cityId, bbox.min_lat, bbox.min_lng, bbox.max_lat, bbox.max_lng],
  );
}
