import { pool } from '../db';
import type { Bbox, CategoryTags, DiscoveryProgress } from '../types/discovery';
import type { CreateMarketInput, Market, MarketStatus } from '../types/market';

const bboxToPolygonWkt = (b: Bbox) =>
  `POLYGON((${b.minLng} ${b.minLat}, ${b.minLng} ${b.maxLat}, ${b.maxLng} ${b.maxLat}, ${b.maxLng} ${b.minLat}, ${b.minLng} ${b.minLat}))`;

/**
 * Area is measured by PostGIS on the spheroid rather than in JavaScript:
 * casting to geography gives square metres, where a planar calculation on
 * degrees would be wrong by a latitude-dependent factor.
 */
export async function boundaryAreaSqKm(boundary: Bbox): Promise<number> {
  const { rows } = await pool.query<{ area: number }>(
    `SELECT ST_Area(ST_GeomFromText($1, 4326)::geography) / 1000000 AS area`,
    [bboxToPolygonWkt(boundary)],
  );
  return rows[0].area;
}

export async function createMarket(input: CreateMarketInput): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO market (city_id, boundary, status)
       VALUES ($1, ST_GeomFromText($2, 4326), 'queued')
       RETURNING id`,
      [input.cityId, bboxToPolygonWkt(input.boundary)],
    );
    const marketId = rows[0].id;

    await client.query(
      `INSERT INTO market_category (market_id, category_id)
       SELECT $1, unnest($2::bigint[])`,
      [marketId, input.categoryIds],
    );

    await client.query('COMMIT');
    return marketId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function findMarket(marketId: number): Promise<Market | null> {
  const { rows } = await pool.query<Market>(
    `SELECT id, city_id, status, error, created_at, updated_at, last_discovered_at
     FROM market WHERE id = $1`,
    [marketId],
  );
  return rows[0] ?? null;
}

export async function findMarketStatus(marketId: number) {
  const { rows } = await pool.query(
    `SELECT id, status, error, last_discovered_at, progress
     FROM market WHERE id = $1`,
    [marketId],
  );
  return rows[0] ?? null;
}

export async function marketBoundaryBbox(marketId: number): Promise<Bbox> {
  const { rows } = await pool.query<Bbox>(
    `SELECT ST_YMin(boundary) AS "minLat", ST_XMin(boundary) AS "minLng",
            ST_YMax(boundary) AS "maxLat", ST_XMax(boundary) AS "maxLng"
     FROM market WHERE id = $1`,
    [marketId],
  );
  if (!rows[0]) throw new Error(`No market with id ${marketId}`);
  return rows[0];
}

export async function setMarketStatus(
  marketId: number,
  status: MarketStatus,
  error: string | null = null,
): Promise<void> {
  await pool.query(`UPDATE market SET status = $2, error = $3 WHERE id = $1`, [
    marketId,
    status,
    error,
  ]);
}

export async function setMarketCompleted(
  marketId: number,
  error: string | null,
): Promise<void> {
  await pool.query(
    `UPDATE market
     SET status = 'completed', error = $2, last_discovered_at = now()
     WHERE id = $1`,
    [marketId, error],
  );
}

export async function setMarketProgress(
  marketId: number,
  progress: DiscoveryProgress,
): Promise<void> {
  // node-pg serialises a plain object into jsonb, so no manual stringify.
  await pool.query('UPDATE market SET progress = $2 WHERE id = $1', [
    marketId,
    progress,
  ]);
}

/** The OSM tag expressions for the categories this market selected. */
export async function marketCategoryTags(
  marketId: number,
): Promise<CategoryTags[]> {
  const { rows } = await pool.query<{
    id: number;
    label: string;
    value: string[];
  }>(
    `SELECT c.id, c.label, c.value
     FROM market_category mc
     JOIN category c ON c.id = mc.category_id
     WHERE mc.market_id = $1
     ORDER BY c.label`,
    [marketId],
  );

  return rows.map((row) => ({
    categoryId: row.id,
    label: row.label,
    tags: row.value.map((expression) => {
      const index = expression.indexOf('=');
      return {
        key: expression.slice(0, index).trim(),
        value: expression.slice(index + 1).trim(),
      };
    }),
  }));
}

export async function categoryIdsExist(ids: number[]): Promise<boolean> {
  const { rows } = await pool.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM category WHERE id = ANY($1::bigint[])',
    [ids],
  );
  return rows[0].count === ids.length;
}

export async function cityExists(cityId: number): Promise<boolean> {
  const { rowCount } = await pool.query('SELECT 1 FROM city WHERE id = $1', [
    cityId,
  ]);
  return rowCount === 1;
}
