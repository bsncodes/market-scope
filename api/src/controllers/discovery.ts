import { config } from '../config';
import {
  tileKeyToBbox,
  tileKeysForBbox,
  tileStepDegrees,
} from '../helpers/tiling';
import {
  classifyPortfolioForMarket,
  countDiscoveredInMarket,
  findFreshTileKeys,
  findGeocodingCandidates,
  saveTileStores,
  setPortfolioLocation,
} from '../repositories/discovery';
import {
  marketBoundaryBbox,
  marketCategoryTags,
  setMarketCompleted,
  setMarketProgress,
  setMarketStatus,
} from '../repositories/market';
import type { DiscoveryProgress, TileFailure } from '../types/discovery';
import { fetchStoresInBbox } from './overpass';
import { geocodeAddress } from './geocode';

export interface DiscoveryOutcome {
  progress: DiscoveryProgress;
  failures: TileFailure[];
  geocoded: number;
  inside: number;
  outside: number;
  discoveredInBoundary: number;
}

/**
 * The whole pipeline for one market: geocode what the boundary might contain,
 * fetch whichever tiles are missing or stale, then classify.
 *
 * Reaching a terminal status is the contract. A market left in `processing`
 * would make the frontend poll forever, so every exit path here writes either
 * `completed` or `failed`.
 */
export async function runDiscovery(
  marketId: number,
): Promise<DiscoveryOutcome> {
  await setMarketStatus(marketId, 'processing');

  try {
    const geocoded = await geocodePortfolioCandidates(marketId);
    const { progress, failures, discoveredInBoundary } =
      await discoverTiles(marketId);
    const { inside, outside } = await classifyPortfolioForMarket(marketId);

    const error =
      failures.length > 0
        ? `${failures.length} tile fetch(es) failed: ${summarize(failures)}`
        : null;

    // Partial failure still completes: whatever succeeded is persisted, with
    // the shortfall recorded so the dashboard can say which areas are missing
    // rather than showing nothing (§3.4).
    //
    // Total failure does not. With no tile fetched and none reusable from
    // cache, the market holds no discovered data at all, and reporting that as
    // "completed" would render an empty map indistinguishable from a genuinely
    // empty area.
    const producedNothing =
      progress.tilesFailed > 0 &&
      progress.tilesFetched === 0 &&
      progress.tilesReused === 0;

    if (producedNothing) {
      await setMarketStatus(marketId, 'failed', error);
    } else {
      await setMarketCompleted(marketId, error);
    }

    return {
      progress,
      failures,
      geocoded,
      inside,
      outside,
      discoveredInBoundary,
    };
  } catch (err) {
    await setMarketStatus(marketId, 'failed', (err as Error).message);
    throw err;
  }
}

async function geocodePortfolioCandidates(marketId: number): Promise<number> {
  const candidates = await findGeocodingCandidates(marketId);
  let geocoded = 0;

  for (const candidate of candidates) {
    // One unresolvable address must not abort the market: it simply stays
    // unlocated and is excluded from classification.
    try {
      const point = await geocodeAddress([
        candidate.address,
        candidate.city,
        candidate.state,
        candidate.country,
      ]);
      if (!point) continue;

      await setPortfolioLocation(candidate.id, point.lat, point.lng);
      geocoded += 1;
    } catch {
      continue;
    }
  }

  return geocoded;
}

async function discoverTiles(marketId: number) {
  const step = tileStepDegrees(config.tileSizeKm);
  const bounds = await marketBoundaryBbox(marketId);
  const tileKeys = tileKeysForBbox(bounds, step);
  const categories = await marketCategoryTags(marketId);

  const progress: DiscoveryProgress = {
    tilesTotal: tileKeys.length * categories.length,
    tilesFetched: 0,
    tilesReused: 0,
    tilesFailed: 0,
  };
  const failures: TileFailure[] = [];
  await setMarketProgress(marketId, progress);

  for (const category of categories) {
    // Freshness is checked per category in one query rather than per tile:
    // a stale row counts as missing, which is what keeps correctness at read
    // time instead of depending on a cleanup job (§3.5).
    const fresh = await findFreshTileKeys(
      tileKeys,
      category.categoryId,
      config.discoveryFreshnessDays,
    );

    for (const tileKey of tileKeys) {
      if (fresh.has(tileKey)) {
        progress.tilesReused += 1;
        continue;
      }

      try {
        const stores = await fetchStoresInBbox(
          tileKeyToBbox(tileKey, step),
          category.tags,
        );
        await saveTileStores(tileKey, category.categoryId, stores);
        progress.tilesFetched += 1;
      } catch (err) {
        progress.tilesFailed += 1;
        failures.push({
          tileKey,
          categoryId: category.categoryId,
          reason: (err as Error).message,
        });
      }

      await setMarketProgress(marketId, progress);
    }
  }

  await setMarketProgress(marketId, progress);
  const discoveredInBoundary = await countDiscoveredInMarket(
    marketId,
    tileKeys,
  );

  return { progress, failures, discoveredInBoundary };
}

function summarize(failures: TileFailure[]): string {
  const reasons = [...new Set(failures.map((f) => f.reason))];
  return reasons.slice(0, 3).join('; ');
}
