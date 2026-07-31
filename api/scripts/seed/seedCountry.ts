import type { PoolClient } from 'pg';
import { Country } from 'country-state-city';
import { SEED_COUNTRY_ISO } from './constants';

export async function seedCountry(client: PoolClient): Promise<number> {
  const country = Country.getAllCountries().find(
    (c) => c.isoCode === SEED_COUNTRY_ISO,
  );
  if (!country) {
    throw new Error(
      `country-state-city has no entry for isoCode=${SEED_COUNTRY_ISO}`,
    );
  }

  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO country (name, iso_code)
     VALUES ($1, $2)
     ON CONFLICT (iso_code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [country.name, country.isoCode],
  );

  return rows[0].id;
}
