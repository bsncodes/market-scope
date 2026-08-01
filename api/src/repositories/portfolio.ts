import { pool } from '../db';
import type { PortfolioRow } from '../types/portfolio';

/**
 * Replaces the entire portfolio in one transaction (cycles/02 §2.1). The
 * delete relies on the ON DELETE CASCADE added to portfolio_store_market in
 * migration 007; without it this fails as soon as any market has classified a
 * store.
 */
export async function replacePortfolio(rows: PortfolioRow[]): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM portfolio_store');

    // ST_MakePoint takes (x, y) — longitude before latitude. Reversing these
    // is silent: the row still inserts, just in the wrong hemisphere.
    const { rowCount } = await client.query(
      `INSERT INTO portfolio_store
         (store_name, address, city, state, country, category, location)
       SELECT v.store_name, v.address, v.city, v.state, v.country, v.category,
              CASE WHEN v.latitude IS NULL OR v.longitude IS NULL THEN NULL
                   ELSE ST_SetSRID(ST_MakePoint(v.longitude, v.latitude), 4326)::geography
              END
       FROM UNNEST(
         $1::text[], $2::text[], $3::text[], $4::text[],
         $5::text[], $6::text[], $7::double precision[], $8::double precision[]
       ) AS v(store_name, address, city, state, country, category, latitude, longitude)`,
      [
        rows.map((r) => r.store_name),
        rows.map((r) => r.address),
        rows.map((r) => r.city),
        rows.map((r) => r.state),
        rows.map((r) => r.country),
        rows.map((r) => r.category),
        rows.map((r) => r.latitude),
        rows.map((r) => r.longitude),
      ],
    );

    await client.query('COMMIT');
    return rowCount ?? 0;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// count() returns bigint, which db.ts already parses into a number via the
// OID 20 type parser — so these arrive numeric, not as strings.
export async function countPortfolioStores(): Promise<{
  total: number;
  located: number;
}> {
  const { rows } = await pool.query<{ total: number; located: number }>(
    `SELECT count(*) AS total,
            count(location) AS located
     FROM portfolio_store`,
  );
  return rows[0];
}
