import type { PoolClient } from 'pg';
import { State } from 'country-state-city';
import { SEED_COUNTRY_ISO } from './constants';

// Maps the package's stateCode (e.g. "AP") -> our state.id, so seedCities
// can look up the right parent without re-querying.
export async function seedStates(
  client: PoolClient,
  countryId: number,
): Promise<Map<string, number>> {
  const states = State.getStatesOfCountry(SEED_COUNTRY_ISO);
  const idByStateCode = new Map<string, number>();

  for (const state of states) {
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO state (country_id, name, code)
       VALUES ($1, $2, $3)
       ON CONFLICT (country_id, code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [countryId, state.name, state.isoCode],
    );
    idByStateCode.set(state.isoCode, rows[0].id);
  }

  return idByStateCode;
}
