import { pool } from '../db';
import type {
  DashboardStore,
  MarketDetail,
  MarketSummary,
  PortfolioStoreForMarket,
} from '../types/dashboard';

/**
 * Every market, newest first, with enough to decide which one to reopen.
 *
 * The discovered count is read from the stored progress rather than recounted:
 * the worker already computed it, and running the boundary query once per
 * market would make this list cost more the more markets exist (§3.6).
 */
export async function listMarkets(limit: number): Promise<MarketSummary[]> {
  const { rows } = await pool.query(
    `SELECT m.id, m.status, m.error, m.created_at, m.last_discovered_at,
            m.progress,
            ST_Area(m.boundary::geography) / 1000000 AS area_sq_km,
            c.id AS city_id, c.name AS city_name,
            s.name AS state_name, co.name AS country_name,
            coalesce(
              (SELECT json_agg(json_build_object('id', cat.id, 'label', cat.label)
                               ORDER BY cat.label)
               FROM market_category mc
               JOIN category cat ON cat.id = mc.category_id
               WHERE mc.market_id = m.id),
              '[]'::json
            ) AS categories,
            coalesce(split.inside, 0) AS portfolio_inside,
            coalesce(split.outside, 0) AS portfolio_outside
     FROM market m
     JOIN city c ON c.id = m.city_id
     JOIN state s ON s.id = c.state_id
     JOIN country co ON co.id = s.country_id
     LEFT JOIN LATERAL (
       SELECT count(*) FILTER (WHERE is_inside)::int AS inside,
              count(*) FILTER (WHERE NOT is_inside)::int AS outside
       FROM portfolio_store_market
       WHERE market_id = m.id
     ) split ON TRUE
     -- id breaks the tie: two markets created in the same millisecond would
     -- otherwise come back in an arbitrary order between calls.
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT $1`,
    [limit],
  );

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    error: row.error,
    created_at: row.created_at,
    last_discovered_at: row.last_discovered_at,
    area_sq_km: row.area_sq_km,
    city: {
      id: row.city_id,
      name: row.city_name,
      state: row.state_name,
      country: row.country_name,
    },
    categories: row.categories,
    discovered_count: row.progress?.discoveredInBoundary ?? null,
    portfolio_inside: row.portfolio_inside,
    portfolio_outside: row.portfolio_outside,
  }));
}

export async function findMarketDetail(
  marketId: number,
): Promise<MarketDetail | null> {
  const { rows } = await pool.query(
    `SELECT m.id, m.status, m.error, m.last_discovered_at, m.progress,
            ST_YMin(m.boundary) AS "minLat", ST_XMin(m.boundary) AS "minLng",
            ST_YMax(m.boundary) AS "maxLat", ST_XMax(m.boundary) AS "maxLng",
            c.id AS city_id, c.name AS city_name,
            s.name AS state_name, co.name AS country_name,
            coalesce(
              (SELECT json_agg(json_build_object('id', cat.id, 'label', cat.label)
                               ORDER BY cat.label)
               FROM market_category mc
               JOIN category cat ON cat.id = mc.category_id
               WHERE mc.market_id = m.id),
              '[]'::json
            ) AS categories
     FROM market m
     JOIN city c ON c.id = m.city_id
     JOIN state s ON s.id = c.state_id
     JOIN country co ON co.id = s.country_id
     WHERE m.id = $1`,
    [marketId],
  );
  if (!rows[0]) return null;

  const row = rows[0];
  return {
    id: row.id,
    status: row.status,
    error: row.error,
    last_discovered_at: row.last_discovered_at,
    progress: row.progress,
    boundary: {
      minLat: row.minLat,
      minLng: row.minLng,
      maxLat: row.maxLat,
      maxLng: row.maxLng,
    },
    city: {
      id: row.city_id,
      name: row.city_name,
      state: row.state_name,
      country: row.country_name,
    },
    categories: row.categories,
  };
}

/**
 * The market's discovered stores, assembled from every tile whose category the
 * market selected, deduped by OSM id and clipped to the exact boundary.
 *
 * No tile_key filter here, unlike the worker's count: a store inside the
 * boundary is necessarily inside a tile that overlaps it, so the spatial
 * predicate alone is equivalent — and it keeps this read path free of any
 * knowledge of the tiling scheme (§3.6: fast reads stay direct).
 */
export async function findDiscoveredStores(
  marketId: number,
): Promise<DashboardStore[]> {
  const { rows } = await pool.query<DashboardStore>(
    `SELECT DISTINCT ON (ds.osm_element_id)
            ds.osm_element_id AS id,
            ds.name,
            ds.category_value AS category,
            ST_Y(ds.location::geometry) AS lat,
            ST_X(ds.location::geometry) AS lng
     FROM discovered_store ds
     JOIN tile_fetch tf ON tf.id = ds.tile_fetch_id
     JOIN market m ON m.id = $1
     JOIN market_category mc
       ON mc.market_id = m.id AND mc.category_id = tf.category_id
     WHERE ST_Contains(m.boundary, ds.location::geometry)
     ORDER BY ds.osm_element_id, ds.id`,
    [marketId],
  );
  return rows;
}

/**
 * Both sides of the split in one query. The frontend renders inside and
 * outside as separate toggleable layers, but fetching them separately would
 * mean two round trips for one classification that is already computed.
 */
export async function findPortfolioForMarket(
  marketId: number,
): Promise<PortfolioStoreForMarket[]> {
  const { rows } = await pool.query<PortfolioStoreForMarket>(
    `SELECT ps.id,
            ps.store_name AS name,
            ps.category,
            ps.address,
            psm.is_inside,
            ST_Y(ps.location::geometry) AS lat,
            ST_X(ps.location::geometry) AS lng
     FROM portfolio_store_market psm
     JOIN portfolio_store ps ON ps.id = psm.portfolio_store_id
     WHERE psm.market_id = $1
     ORDER BY ps.store_name`,
    [marketId],
  );
  return rows;
}
