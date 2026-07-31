import type { PoolClient } from 'pg';
import { City } from 'country-state-city';
import { SEED_COUNTRY_ISO } from './constants';

export async function seedCities(
  client: PoolClient,
  stateIdByStateCode: Map<string, number>,
): Promise<void> {
  for (const [stateCode, stateId] of stateIdByStateCode) {
    const cities = City.getCitiesOfState(SEED_COUNTRY_ISO, stateCode);
    if (cities.length === 0) continue;

    await client.query(
      `INSERT INTO city (state_id, name)
       SELECT $1, v.name
       FROM UNNEST($2::text[]) AS v(name)
       ON CONFLICT (state_id, name) DO NOTHING`,
      [stateId, cities.map((c) => c.name)],
    );
  }
}
