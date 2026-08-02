import { Router } from 'express';
import { config } from '../config';
import { requestValidationFailed, resourceNotFound } from '../errors';
import { requireId } from '../helpers/request';
import { enqueueDiscovery } from '../queue';
import {
  findDiscoveredStores,
  findMarketDetail,
  findPortfolioForMarket,
  listMarkets,
} from '../repositories/dashboard';
import {
  boundaryAreaSqKm,
  categoryIdsExist,
  cityExists,
  createMarket,
  findMarket,
  findMarketStatus,
} from '../repositories/market';
import { HttpStatus } from '../types/http';
import type { Bbox } from '../types/discovery';

export const marketRouter = Router();

marketRouter.post('/', async (req, res) => {
  const { cityId, categoryIds, boundary } = parseCreateMarket(req.body);

  if (!(await cityExists(cityId))) {
    throw resourceNotFound(`No city with id ${cityId}.`);
  }
  if (!(await categoryIdsExist(categoryIds))) {
    throw requestValidationFailed('One or more categoryIds do not exist.');
  }

  // Checked server-side as well as in the UI: the cap bounds how much work a
  // single job can create, so it cannot be left to the client.
  const areaSqKm = await boundaryAreaSqKm(boundary);
  if (areaSqKm > config.marketMaxAreaSqKm) {
    throw requestValidationFailed(
      `Boundary covers ${areaSqKm.toFixed(2)} sq km, above the ${config.marketMaxAreaSqKm} sq km limit.`,
      { area_sq_km: areaSqKm, max_sq_km: config.marketMaxAreaSqKm },
    );
  }

  const marketId = await createMarket({ cityId, categoryIds, boundary });
  await enqueueDiscovery(marketId);

  // 202: the market row exists, but discovery has only been queued. Doing the
  // work here would block the request for as long as the fetches take (§3.6).
  res.status(HttpStatus.Accepted).json({
    market_id: marketId,
    status: 'queued',
    area_sq_km: Number(areaSqKm.toFixed(4)),
  });
});

marketRouter.get('/:marketId/status', async (req, res) => {
  const marketId = requireId(req.params.marketId, 'marketId');
  const market = await findMarketStatus(marketId);
  if (!market) {
    throw resourceNotFound(`No market with id ${marketId}.`);
  }

  res.json({
    market_id: market.id,
    status: market.status,
    error: market.error,
    last_discovered_at: market.last_discovered_at,
    progress: market.progress ?? null,
  });
});

const MAX_MARKETS_PER_PAGE = 100;

marketRouter.get('/', async (req, res) => {
  const limit = parseLimit(req.query.limit);
  const markets = await listMarkets(limit);
  res.json({ count: markets.length, limit, markets });
});

marketRouter.get('/:marketId', async (req, res) => {
  const marketId = requireId(req.params.marketId, 'marketId');
  const market = await findMarketDetail(marketId);
  if (!market) {
    throw resourceNotFound(`No market with id ${marketId}.`);
  }

  res.json({
    market_id: market.id,
    status: market.status,
    error: market.error,
    last_discovered_at: market.last_discovered_at,
    progress: market.progress,
    boundary: market.boundary,
    city: market.city,
    categories: market.categories,
  });
});

marketRouter.get('/:marketId/discovered-stores', async (req, res) => {
  const marketId = await requireExistingMarket(req.params.marketId);
  const stores = await findDiscoveredStores(marketId);
  res.json({ market_id: marketId, count: stores.length, stores });
});

marketRouter.get('/:marketId/portfolio', async (req, res) => {
  const marketId = await requireExistingMarket(req.params.marketId);
  const stores = await findPortfolioForMarket(
    marketId,
    config.storeMatchRadiusM,
  );

  // Every side comes back in one payload with the flags intact; the frontend
  // toggles them as independent layers, and the counts are what the dashboard
  // header shows without it having to filter three times.
  res.json({
    market_id: marketId,
    match_radius_m: config.storeMatchRadiusM,
    inside_count: stores.filter((store) => store.is_inside).length,
    outside_count: stores.filter((store) => !store.is_inside).length,
    matched_count: stores.filter((store) => store.matched).length,
    stores,
  });
});

/**
 * Bounded rather than unbounded: a demo accumulates markets quickly, and the
 * list view only ever shows the recent ones. A rejected limit is better than
 * silently clamping, so the caller learns their page size was ignored.
 */
function parseLimit(raw: unknown): number {
  if (raw === undefined) return 25;

  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_MARKETS_PER_PAGE) {
    throw requestValidationFailed(
      `limit must be an integer between 1 and ${MAX_MARKETS_PER_PAGE}.`,
    );
  }
  return limit;
}

/**
 * An unknown market and a market with nothing in it both return an empty
 * list otherwise, which reads to the UI as "discovery found nothing".
 */
async function requireExistingMarket(raw: unknown): Promise<number> {
  const marketId = requireId(raw, 'marketId');
  if (!(await findMarket(marketId))) {
    throw resourceNotFound(`No market with id ${marketId}.`);
  }
  return marketId;
}

function parseCreateMarket(body: unknown): {
  cityId: number;
  categoryIds: number[];
  boundary: Bbox;
} {
  if (typeof body !== 'object' || body === null) {
    throw requestValidationFailed('Request body must be a JSON object.');
  }
  const input = body as Record<string, unknown>;

  const cityId = requireId(input.cityId, 'cityId');

  if (!Array.isArray(input.categoryIds) || input.categoryIds.length === 0) {
    throw requestValidationFailed('categoryIds must be a non-empty array.');
  }
  const categoryIds = input.categoryIds.map((id, index) =>
    requireId(id, `categoryIds[${index}]`),
  );

  return { cityId, categoryIds, boundary: parseBoundary(input.boundary) };
}

function parseBoundary(raw: unknown): Bbox {
  if (typeof raw !== 'object' || raw === null) {
    throw requestValidationFailed(
      'boundary must be an object with minLat, minLng, maxLat and maxLng.',
    );
  }

  const source = raw as Record<string, unknown>;
  const bbox = {} as Bbox;

  for (const key of ['minLat', 'minLng', 'maxLat', 'maxLng'] as const) {
    const value = Number(source[key]);
    if (!Number.isFinite(value)) {
      throw requestValidationFailed(`boundary.${key} must be a number.`);
    }
    bbox[key] = value;
  }

  const latLimit = 90;
  const lngLimit = 180;
  if (Math.abs(bbox.minLat) > latLimit || Math.abs(bbox.maxLat) > latLimit) {
    throw requestValidationFailed('boundary latitudes must be within ±90.');
  }
  if (Math.abs(bbox.minLng) > lngLimit || Math.abs(bbox.maxLng) > lngLimit) {
    throw requestValidationFailed('boundary longitudes must be within ±180.');
  }
  // A degenerate or inverted box would produce a polygon PostGIS rejects, or
  // worse, an empty one that silently matches nothing.
  if (bbox.minLat >= bbox.maxLat || bbox.minLng >= bbox.maxLng) {
    throw requestValidationFailed(
      'boundary minimums must be strictly less than maximums.',
    );
  }

  return bbox;
}
