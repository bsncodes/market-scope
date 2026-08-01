import { pool } from '../../src/db';
import type { Bbox } from '../../src/types/discovery';

export async function clearDiscoveryState(): Promise<void> {
  // Order matters: portfolio_store_market and market_category reference market.
  await pool.query('DELETE FROM portfolio_store_market');
  await pool.query('DELETE FROM market_category');
  await pool.query('DELETE FROM market');
  await pool.query('DELETE FROM discovered_store');
  await pool.query('DELETE FROM tile_fetch');
  await pool.query('DELETE FROM portfolio_store');
  await pool.query('DELETE FROM geocode_cache');
}

export async function seedCategory(
  label: string,
  tags: string[],
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO category (label, value) VALUES ($1, $2)
     ON CONFLICT (label) DO UPDATE SET value = EXCLUDED.value
     RETURNING id`,
    [label, tags],
  );
  return rows[0].id;
}

export async function anyCityId(): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    'SELECT id FROM city ORDER BY id LIMIT 1',
  );
  return rows[0].id;
}

export async function insertPortfolioStore(store: {
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  lat?: number;
  lng?: number;
}): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO portfolio_store
       (store_name, address, city, state, country, category, location)
     VALUES ($1, $2, $3, $4, $5, 'Supermarket',
       CASE WHEN $6::double precision IS NULL THEN NULL
            ELSE ST_SetSRID(ST_MakePoint($7, $6), 4326)::geography END)
     RETURNING id`,
    [
      store.name,
      store.address ?? null,
      store.city ?? null,
      store.state ?? null,
      store.country ?? null,
      store.lat ?? null,
      store.lng ?? null,
    ],
  );
  return rows[0].id;
}

export async function countStoresInsideBoundary(
  marketId: number,
): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    `SELECT count(DISTINCT ds.osm_element_id)::int AS count
     FROM discovered_store ds
     JOIN tile_fetch tf ON tf.id = ds.tile_fetch_id
     JOIN market m ON m.id = $1
     JOIN market_category mc
       ON mc.market_id = m.id AND mc.category_id = tf.category_id
     WHERE ST_Contains(m.boundary, ds.location::geometry)`,
    [marketId],
  );
  return rows[0].count;
}

export async function portfolioClassification(marketId: number) {
  const { rows } = await pool.query<{ store_name: string; is_inside: boolean }>(
    `SELECT ps.store_name, psm.is_inside
     FROM portfolio_store_market psm
     JOIN portfolio_store ps ON ps.id = psm.portfolio_store_id
     WHERE psm.market_id = $1
     ORDER BY ps.store_name`,
    [marketId],
  );
  return rows;
}

export async function ageTileFetches(days: number): Promise<void> {
  await pool.query(
    `UPDATE tile_fetch SET fetched_at = now() - ($1 || ' days')::interval`,
    [String(days)],
  );
}

/** A boundary comfortably under the 30 sq km cap, near Bengaluru. */
export const SMALL_BOUNDARY: Bbox = {
  minLat: 12.96,
  minLng: 77.59,
  maxLat: 12.98,
  maxLng: 77.61,
};
