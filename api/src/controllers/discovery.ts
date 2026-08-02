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
import {
  emptyProgress,
  type Bbox,
  type DiscoveryProgress,
  type TileFailure,
} from '../types/discovery';
import { fetchStoresInBbox } from './overpass';
import { geocodeAddress } from './geocode';

export interface DiscoveryOutcome {
  progress: DiscoveryProgress;
  failures: TileFailure[];
  inside: number;
  outside: number;
}

/**
 * The whole pipeline for one market: geocode what the boundary might contain,
 * fetch whichever tiles are missing or stale, then classify.
 *
 * On a completed run this writes the terminal status itself. On a throw it
 * deliberately does not: only the worker knows whether attempts remain, and
 * writing `failed` here would contradict a retry that is about to succeed.
 */
export async function runDiscovery(
  marketId: number,
): Promise<DiscoveryOutcome> {
  await setMarketStatus(marketId, 'processing');

  const progress = emptyProgress();

  const geocodeSummary = await geocodePortfolioCandidates(marketId, progress);
  const failures = await discoverTiles(marketId, progress);
  const { inside, outside } = await classifyPortfolioForMarket(marketId);

  progress.discoveredInBoundary = await countDiscoveredInMarket(
    marketId,
    tileKeysForMarketBounds(await marketBoundaryBbox(marketId)),
  );
  await setMarketProgress(marketId, progress);

  const error = describeShortfall(failures, geocodeSummary);

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

  return { progress, failures, inside, outside };
}

interface GeocodeSummary {
  candidates: number;
  resolved: number;
  unresolved: number;
  failed: number;
}

/**
 * Resolves coordinates for the portfolio rows that still lack them.
 *
 * Every row here is already known to have `location IS NULL` — that is the
 * first condition in findGeocodingCandidates. A store whose CSV supplied
 * latitude and longitude had its point built at upload time, so it is never
 * selected and never costs a Nominatim call. Widening that query would
 * silently start re-geocoding located stores at roughly a second each.
 */
async function geocodePortfolioCandidates(
  marketId: number,
  progress: DiscoveryProgress,
): Promise<GeocodeSummary> {
  const candidates = await findGeocodingCandidates(marketId);
  const summary: GeocodeSummary = {
    candidates: candidates.length,
    resolved: 0,
    unresolved: 0,
    failed: 0,
  };

  for (const candidate of candidates) {
    try {
      const point = await geocodeAddress([
        candidate.address,
        candidate.city,
        candidate.state,
        candidate.country,
      ]);

      // A null result means the address is genuinely unresolvable, which is a
      // normal outcome for user-supplied data. A throw means the call itself
      // failed, which points at the service rather than the row — counted
      // separately so an outage is not mistaken for a portfolio that simply
      // does not reach this market.
      if (!point) {
        summary.unresolved += 1;
        continue;
      }

      await setPortfolioLocation(candidate.id, point.lat, point.lng);
      summary.resolved += 1;
    } catch (err) {
      summary.failed += 1;
      console.warn(
        `geocoding failed for portfolio_store ${candidate.id}: ${(err as Error).message}`,
      );
    }
  }

  progress.geocodeCandidates = summary.candidates;
  progress.geocodeResolved = summary.resolved;
  progress.geocodeUnresolved = summary.unresolved;
  progress.geocodeFailed = summary.failed;
  return summary;
}

/**
 * What the client is told went wrong. Only text this code produced — an
 * upstream message could carry connection detail or SQL fragments.
 */
function describeShortfall(
  failures: TileFailure[],
  geocoding: GeocodeSummary,
): string | null {
  const parts: string[] = [];

  if (failures.length > 0) {
    const tiles = new Set(failures.map((f) => f.tileKey)).size;
    parts.push(
      `${tiles} area${tiles > 1 ? 's' : ''} could not be fetched, so some stores may be missing.`,
    );
  }

  // Every candidate erroring points at the geocoder, not the addresses.
  if (geocoding.failed > 0 && geocoding.resolved === 0) {
    parts.push(
      'The geocoding service was unavailable, so stores without coordinates could not be placed.',
    );
  } else if (geocoding.failed > 0) {
    parts.push(
      `${geocoding.failed} store${geocoding.failed > 1 ? 's' : ''} could not be geocoded.`,
    );
  }

  return parts.length > 0 ? parts.join(' ') : null;
}

export function tileKeysForMarketBounds(bounds: Bbox): string[] {
  return tileKeysForBbox(bounds, tileStepDegrees(config.tileSizeKm));
}

async function discoverTiles(
  marketId: number,
  progress: DiscoveryProgress,
): Promise<TileFailure[]> {
  const step = tileStepDegrees(config.tileSizeKm);
  const bounds = await marketBoundaryBbox(marketId);
  const tileKeys = tileKeysForBbox(bounds, step);
  const categories = await marketCategoryTags(marketId);

  progress.tilesTotal = tileKeys.length * categories.length;
  const failures: TileFailure[] = [];
  await setMarketProgress(marketId, progress);

  // Progress is written on a timer rather than per tile. A market can cover
  // hundreds of tile-category pairs, and the poll loop reads every ~10s, so a
  // write per tile is chatty without telling anyone anything sooner.
  let lastWriteAt = Date.now();
  const flushIfDue = async () => {
    if (Date.now() - lastWriteAt < config.progressWriteIntervalMs) return;
    lastWriteAt = Date.now();
    await setMarketProgress(marketId, progress);
  };

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

      await flushIfDue();
    }

    // Always land a write on a category boundary, so a long single-category
    // market still reports something.
    await setMarketProgress(marketId, progress);
    lastWriteAt = Date.now();
  }

  return failures;
}
