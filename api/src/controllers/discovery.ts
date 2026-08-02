import { config } from '../config';
import { ProgressReporter } from '../helpers/progressReporter';
import {
  tileKeyToBbox,
  tileKeysForBbox,
  tileStepDegrees,
} from '../helpers/tiling';
import {
  classifyPortfolioForMarket,
  countDiscoveredInMarket,
  findFreshTileKeys,
  findUnlocatedStoresNear,
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
import { geocodeAddress } from './geocode';
import { fetchStoresInBbox } from './overpass';

export interface DiscoveryOutcome {
  progress: DiscoveryProgress;
  failures: TileFailure[];
  inside: number;
  outside: number;
}

interface TileResult {
  failures: TileFailure[];
  /** Returned so the caller need not re-derive what this stage already computed. */
  tileKeys: string[];
}

/**
 * The whole pipeline for one market.
 *
 * Tiles run before geocoding deliberately. Discovery has no dependency on
 * portfolio coordinates, and finishing it first means the dashboard's
 * discovered-stores layer is ready in seconds rather than after a portfolio
 * that may take minutes to locate.
 *
 * On a completed run this writes the terminal status itself. On a throw it
 * deliberately does not: only the worker knows whether attempts remain, and
 * writing `failed` here would contradict a retry that is about to succeed.
 */
export async function runDiscovery(
  marketId: number,
): Promise<DiscoveryOutcome> {
  await setMarketStatus(marketId, 'processing');

  const reporter = new ProgressReporter(
    marketId,
    setMarketProgress,
    config.progressWriteIntervalMs,
  );

  const tiles = await discoverTiles(marketId, reporter);
  await geocodeUnlocatedStores(marketId, reporter);
  const { inside, outside } = await classifyPortfolioForMarket(marketId);

  reporter.set({
    discoveredInBoundary: await countDiscoveredInMarket(
      marketId,
      tiles.tileKeys,
    ),
  });
  await reporter.flush();

  const progress = reporter.snapshot();
  const error = describeShortfall(tiles.failures, progress);

  // Partial failure still completes: whatever succeeded is persisted, with the
  // shortfall recorded so the dashboard can say which areas are missing rather
  // than showing nothing (§3.4).
  //
  // Total failure does not. With no tile fetched and none reusable from cache,
  // the market holds no discovered data at all, and reporting that as
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

  return { progress, failures: tiles.failures, inside, outside };
}

async function discoverTiles(
  marketId: number,
  reporter: ProgressReporter,
): Promise<TileResult> {
  const step = tileStepDegrees(config.tileSizeKm);
  const bounds = await marketBoundaryBbox(marketId);
  const tileKeys = tileKeysForBbox(bounds, step);
  const categories = await marketCategoryTags(marketId);

  reporter.set({ tilesTotal: tileKeys.length * categories.length });
  await reporter.flush();

  const failures: TileFailure[] = [];

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
        reporter.increment('tilesReused');
        continue;
      }

      try {
        const stores = await fetchStoresInBbox(
          tileKeyToBbox(tileKey, step),
          category.tags,
        );
        await saveTileStores(tileKey, category.categoryId, stores);
        reporter.increment('tilesFetched');
      } catch (err) {
        reporter.increment('tilesFailed');
        failures.push({
          tileKey,
          categoryId: category.categoryId,
          reason: (err as Error).message,
        });
      }

      await reporter.flushIfDue();
    }

    // Always land a write on a category boundary, so a market covering a
    // single category still reports something before it finishes.
    await reporter.flush();
  }

  return { failures, tileKeys };
}

/**
 * Resolves coordinates for the portfolio rows that still lack them.
 *
 * Every row here is already known to have `location IS NULL` — that is the
 * first condition in findUnlocatedStoresNear. A store whose CSV supplied
 * latitude and longitude had its point built at upload time, so it is never
 * selected and never costs a Nominatim call. Widening that query would
 * silently start re-geocoding located stores at roughly a second each.
 */
async function geocodeUnlocatedStores(
  marketId: number,
  reporter: ProgressReporter,
): Promise<void> {
  const unlocatedStores = await findUnlocatedStoresNear(marketId);
  reporter.set({ geocodeCandidates: unlocatedStores.length });
  await reporter.flush();

  for (const store of unlocatedStores) {
    try {
      const point = await geocodeAddress([
        store.address,
        store.city,
        store.state,
        store.country,
      ]);

      // A null result means the address is genuinely unresolvable, which is a
      // normal outcome for user-supplied data. A throw means the call itself
      // failed, which points at the service rather than the row — counted
      // separately so an outage is not mistaken for a portfolio that simply
      // does not reach this market.
      if (!point) {
        reporter.increment('geocodeUnresolved');
        continue;
      }

      await setPortfolioLocation(store.id, point.lat, point.lng);
      reporter.increment('geocodeResolved');
    } catch (err) {
      reporter.increment('geocodeFailed');
      console.warn(
        `geocoding failed for portfolio_store ${store.id}: ${(err as Error).message}`,
      );
    }

    await reporter.flushIfDue();
  }

  await reporter.flush();
}

/**
 * What the client is told went wrong. Only text this code produced — an
 * upstream message could carry connection detail or SQL fragments.
 */
function describeShortfall(
  failures: TileFailure[],
  progress: DiscoveryProgress,
): string | null {
  const parts: string[] = [];

  if (failures.length > 0) {
    const areas = new Set(failures.map((f) => f.tileKey)).size;
    parts.push(
      `${areas} area${areas > 1 ? 's' : ''} could not be fetched, so some stores may be missing.`,
    );
  }

  // Every candidate erroring points at the geocoder, not the addresses.
  if (progress.geocodeFailed > 0 && progress.geocodeResolved === 0) {
    parts.push(
      'The geocoding service was unavailable, so stores without coordinates could not be placed.',
    );
  } else if (progress.geocodeFailed > 0) {
    parts.push(
      `${progress.geocodeFailed} store${progress.geocodeFailed > 1 ? 's' : ''} could not be geocoded.`,
    );
  }

  return parts.length > 0 ? parts.join(' ') : null;
}
