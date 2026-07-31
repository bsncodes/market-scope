import type { Pool } from 'pg';
import { Country } from 'country-state-city';

export async function seedCountry(pool: Pool): Promise<number> {
  const india = Country.getAllCountries().find((c) => c.isoCode === 'IN');
  if (!india) {
    throw new Error('country-state-city has no India entry (isoCode=IN)');
  }

  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO country (name, iso_code)
     VALUES ($1, $2)
     ON CONFLICT (iso_code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [india.name, india.isoCode],
  );

  return rows[0].id;
}
