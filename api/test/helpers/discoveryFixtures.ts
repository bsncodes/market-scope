import { pool } from '../../src/db';
import type { Bbox } from '../../src/types/discovery';

// Categories this run invented, so they can be removed again. Deleting every
// category instead would take the seeded reference data with it, and leaving
// them behind pollutes a shared dev database — they show up in the app's real
// category picker.
const seededCategoryIds = new Set<number>();

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

/**
 * Only safe once a suite is finished: the categories are created in `before`
 * and `clearDiscoveryState` runs between every test, so folding this into it
 * would delete the category the running spec still holds an id for.
 */
export async function clearDiscoveryFixtures(): Promise<void> {
  await clearDiscoveryState();

  if (seededCategoryIds.size > 0) {
    // market_category and tile_fetch both reference category with RESTRICT, so
    // this has to come after clearDiscoveryState has emptied them.
    await pool.query('DELETE FROM category WHERE id = ANY($1::bigint[])', [
      [...seededCategoryIds],
    ]);
    seededCategoryIds.clear();
  }
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
  seededCategoryIds.add(rows[0].id);
  return rows[0].id;
}

export async function anyCityId(): Promise<number> {
  return (await anyCity()).id;
}

/**
 * The name matters as well as the id: the geocoding pre-filter matches a
 * portfolio row's free-text city against the market's, so a test that wants a
 * store to be considered a candidate has to use a city that actually matches.
 */
export async function anyCity(): Promise<{ id: number; name: string }> {
  const { rows } = await pool.query<{ id: number; name: string }>(
    'SELECT id, name FROM city ORDER BY id LIMIT 1',
  );
  return rows[0];
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
