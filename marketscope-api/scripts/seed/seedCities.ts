import type { Pool } from 'pg';
import { City } from 'country-state-city';

// Batches one INSERT per state (not one per city) — ~36 statements instead
// of ~4200 — since the seed script has no need to read city ids back out.
export async function seedCities(
  pool: Pool,
  stateIdByStateCode: Map<string, number>,
): Promise<void> {
  for (const [stateCode, stateId] of stateIdByStateCode) {
    const cities = City.getCitiesOfState('IN', stateCode);
    if (cities.length === 0) continue;

    await pool.query(
      `INSERT INTO city (state_id, name)
       SELECT $1, v.name
       FROM UNNEST($2::text[]) AS v(name)
       ON CONFLICT (state_id, name) DO NOTHING`,
      [stateId, cities.map((c) => c.name)],
    );
  }
}
