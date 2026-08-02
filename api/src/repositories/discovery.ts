import { pool } from '../db';
import type { DiscoveredStore } from '../types/discovery';

/**
 * Which of these tile+category pairs are already cached AND fresh. "Cached"
 * alone is not enough: a stale row is treated exactly like a missing one and
 * re-fetched, which is what keeps correctness at read time rather than relying
 * on a cleanup job (§3.5).
 */
export async function findFreshTileKeys(
  tileKeys: string[],
  categoryId: number,
  freshnessDays: number,
): Promise<Set<string>> {
  const { rows } = await pool.query<{ tile_key: string }>(
    `SELECT tile_key
     FROM tile_fetch
     WHERE category_id = $2
       AND tile_key = ANY($1::text[])
       AND fetched_at > now() - ($3 || ' days')::interval`,
    [tileKeys, categoryId, String(freshnessDays)],
  );
  return new Set(rows.map((row) => row.tile_key));
}

/**
 * Replaces one tile+category's contents in a transaction. Upsert-overwrite
 * rather than append: a re-fetch reflects the world now, so stores that closed
 * must disappear rather than linger forever.
 */
export async function saveTileStores(
  tileKey: string,
  categoryId: number,
  stores: DiscoveredStore[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO tile_fetch (tile_key, category_id, fetched_at)
       VALUES ($1, $2, now())
       ON CONFLICT (tile_key, category_id)
       DO UPDATE SET fetched_at = now()
       RETURNING id`,
      [tileKey, categoryId],
    );
    const tileFetchId = rows[0].id;

    await client.query(
      'DELETE FROM discovered_store WHERE tile_fetch_id = $1',
      [tileFetchId],
    );

    if (stores.length > 0) {
      // Overpass can return the same element twice within one response, so
      // dedupe before insert rather than relying on the unique constraint.
      const unique = new Map(stores.map((s) => [s.osmElementId, s]));
      const rowsToInsert = [...unique.values()];

      await client.query(
        `INSERT INTO discovered_store
           (tile_fetch_id, osm_element_id, name, category_value, location)
         SELECT $1, v.osm_element_id, v.name, v.category_value,
                ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326)::geography
         FROM UNNEST($2::text[], $3::text[], $4::text[],
                     $5::double precision[], $6::double precision[])
              AS v(osm_element_id, name, category_value, lat, lng)`,
        [
          tileFetchId,
          rowsToInsert.map((s) => s.osmElementId),
          rowsToInsert.map((s) => s.name),
          rowsToInsert.map((s) => s.categoryValue),
          rowsToInsert.map((s) => s.lat),
          rowsToInsert.map((s) => s.lng),
        ],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The market's discovered set, assembled from every overlapping tile then
 * clipped to the exact boundary. Tiles are coarser than the drawn rectangle,
 * so without ST_Contains the result would include stores outside it.
 *
 * DISTINCT ON dedupes by osm_element_id: one store can sit in two tiles when
 * it lies near a tile edge.
 */
export async function countDiscoveredInMarket(
  marketId: number,
  tileKeys: string[],
): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM (
       SELECT DISTINCT ON (ds.osm_element_id) ds.id
       FROM discovered_store ds
       JOIN tile_fetch tf ON tf.id = ds.tile_fetch_id
       JOIN market m ON m.id = $1
       JOIN market_category mc
         ON mc.market_id = m.id AND mc.category_id = tf.category_id
       WHERE tf.tile_key = ANY($2::text[])
         AND ST_Contains(m.boundary, ds.location::geometry)
       ORDER BY ds.osm_element_id, ds.id
     ) unique_stores`,
    [marketId, tileKeys],
  );
  return rows[0].count;
}

export interface UnlocatedStore {
  id: number;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
}

/**
 * Portfolio rows that still have no coordinates and might fall inside this
 * market. The `location IS NULL` condition is load-bearing: a store whose CSV
 * supplied latitude and longitude already had its point built at upload time,
 * so it is never returned here and never costs a geocoding call.
 *
 * The text match is deliberately loose — case-insensitive, partial, and OR'd
 * across city/state/country. Its only job is to bound how many Nominatim calls
 * a market costs. ST_Contains decides inside/outside afterwards; a stricter
 * filter here would silently drop a store whose free-text city reads
 * "Bangalore" where the reference data says "Bengaluru" (§3.2).
 */
export async function findUnlocatedStoresNear(
  marketId: number,
): Promise<UnlocatedStore[]> {
  const { rows } = await pool.query<UnlocatedStore>(
    `WITH target AS (
       SELECT c.name AS city, s.name AS state, co.name AS country
       FROM market m
       JOIN city c ON c.id = m.city_id
       JOIN state s ON s.id = c.state_id
       JOIN country co ON co.id = s.country_id
       WHERE m.id = $1
     )
     SELECT ps.id, ps.address, ps.city, ps.state, ps.country
     FROM portfolio_store ps, target t
     WHERE ps.location IS NULL
       AND ps.address IS NOT NULL
       AND (
         -- No region text at all is not evidence of being elsewhere, so the
         -- row stays a candidate. Excluding it would silently drop a store
         -- that ST_Contains might well place inside the boundary (§3.2).
         (ps.city IS NULL AND ps.state IS NULL AND ps.country IS NULL)
         OR ps.city ILIKE '%' || t.city || '%'
         OR t.city ILIKE '%' || ps.city || '%'
         OR ps.state ILIKE '%' || t.state || '%'
         OR ps.country ILIKE '%' || t.country || '%'
       )`,
    [marketId],
  );
  return rows;
}

export async function findCachedGeocode(
  normalizedAddress: string,
): Promise<{ lat: number; lng: number } | null> {
  const { rows } = await pool.query<{ lat: number; lng: number }>(
    `SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
     FROM geocode_cache WHERE normalized_address = $1`,
    [normalizedAddress],
  );
  return rows[0] ?? null;
}

export async function saveGeocode(
  normalizedAddress: string,
  lat: number,
  lng: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO geocode_cache (normalized_address, location)
     VALUES ($1, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography)
     ON CONFLICT (normalized_address) DO NOTHING`,
    [normalizedAddress, lat, lng],
  );
}

export async function setPortfolioLocation(
  portfolioStoreId: number,
  lat: number,
  lng: number,
): Promise<void> {
  await pool.query(
    `UPDATE portfolio_store
     SET location = ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography
     WHERE id = $1`,
    [portfolioStoreId, lat, lng],
  );
}

/**
 * Classifies every located portfolio store against this market's boundary.
 * ST_Contains needs two geometries, hence the cast: location is geography so
 * that distance work elsewhere comes out in metres rather than degrees.
 */
export async function classifyPortfolioForMarket(
  marketId: number,
): Promise<{ inside: number; outside: number }> {
  const { rows } = await pool.query<{ inside: number; outside: number }>(
    `WITH classified AS (
       INSERT INTO portfolio_store_market (market_id, portfolio_store_id, is_inside)
       SELECT m.id, ps.id, ST_Contains(m.boundary, ps.location::geometry)
       FROM market m, portfolio_store ps
       WHERE m.id = $1 AND ps.location IS NOT NULL
       ON CONFLICT (market_id, portfolio_store_id)
       DO UPDATE SET is_inside = EXCLUDED.is_inside
       RETURNING is_inside
     )
     SELECT
       count(*) FILTER (WHERE is_inside)::int AS inside,
       count(*) FILTER (WHERE NOT is_inside)::int AS outside
     FROM classified`,
    [marketId],
  );
  return rows[0];
}
