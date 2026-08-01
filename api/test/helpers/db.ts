import { pool } from '../../src/db';

export async function clearPortfolio(): Promise<void> {
  await pool.query('DELETE FROM portfolio_store');
}

export async function clearCityBbox(cityId: number): Promise<void> {
  await pool.query(
    `UPDATE city
     SET min_lat = NULL, min_lng = NULL, max_lat = NULL, max_lng = NULL
     WHERE id = $1`,
    [cityId],
  );
}

export async function readCityBbox(cityId: number) {
  const { rows } = await pool.query(
    'SELECT min_lat, min_lng, max_lat, max_lng FROM city WHERE id = $1',
    [cityId],
  );
  return rows[0];
}

/** Reference data is seeded, so tests look ids up rather than hardcoding them. */
export async function findSeedIds() {
  const { rows: countries } = await pool.query(
    "SELECT id FROM country WHERE iso_code = 'IN'",
  );
  const countryId = countries[0].id as number;

  const { rows: states } = await pool.query(
    'SELECT id, code FROM state WHERE country_id = $1 ORDER BY code',
    [countryId],
  );
  const karnataka = states.find((s) => s.code === 'KA')!.id as number;
  const otherState = states.find((s) => s.code !== 'KA')!.id as number;

  const { rows: cities } = await pool.query(
    'SELECT id FROM city WHERE state_id = $1 ORDER BY id LIMIT 1',
    [karnataka],
  );

  return {
    countryId,
    stateId: karnataka,
    otherStateId: otherState,
    cityId: cities[0].id as number,
  };
}

export async function countPortfolioRows(): Promise<number> {
  const { rows } = await pool.query(
    'SELECT count(*) AS n FROM portfolio_store',
  );
  return Number(rows[0].n);
}
