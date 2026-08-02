import { expect } from 'chai';
import { runDiscovery } from '../../src/controllers/discovery';
import { createMarket, findMarketStatus } from '../../src/repositories/market';
import type { Bbox } from '../../src/types/discovery';
import {
  ageTileFetches,
  anyCity,
  clearDiscoveryState,
  countStoresInsideBoundary,
  insertPortfolioStore,
  portfolioClassification,
  seedCategory,
  SMALL_BOUNDARY,
} from '../helpers/discoveryFixtures';
import {
  overpassStub,
  respondWithBadRequest,
  respondWithServerError,
  respondWithStoresInBbox,
} from '../helpers/overpassStub';

/** The market always exists in these specs; this keeps the assertions flat. */
async function readStatus(marketId: number) {
  const status = await findMarketStatus(marketId);
  if (!status) throw new Error(`market ${marketId} disappeared`);
  return status;
}

describe('discovery pipeline', () => {
  let cityId: number;
  let cityName: string;
  let categoryId: number;

  before(async () => {
    ({ id: cityId, name: cityName } = await anyCity());
    categoryId = await seedCategory('Test Supermarket', ['shop=supermarket']);
  });

  beforeEach(async () => {
    await clearDiscoveryState();
    overpassStub.reset();
  });

  after(clearDiscoveryState);

  const newMarket = (boundary: Bbox = SMALL_BOUNDARY) =>
    createMarket({ cityId, categoryIds: [categoryId], boundary });

  describe('tile fetching', () => {
    it('queries Overpass once per tile and stores what it finds', async () => {
      overpassStub.respondWith(
        respondWithStoresInBbox([
          { id: 1, lat: 12.965, lon: 77.595 },
          { id: 2, lat: 12.975, lon: 77.605 },
        ]),
      );

      const marketId = await newMarket();
      const outcome = await runDiscovery(marketId);

      expect(outcome.progress.tilesTotal).to.be.greaterThan(0);
      expect(outcome.progress.tilesFetched).to.equal(
        outcome.progress.tilesTotal,
      );
      expect(overpassStub.requestCount).to.equal(outcome.progress.tilesTotal);
      expect(outcome.progress.discoveredInBoundary).to.equal(2);
    });

    it('sends the tile bbox and the category tag in the query', async () => {
      overpassStub.respondWith(respondWithStoresInBbox([]));
      await runDiscovery(await newMarket());

      expect(overpassStub.queries[0]).to.match(/shop.*supermarket/);
      expect(overpassStub.queries[0]).to.match(/node\[/);
      expect(overpassStub.queries[0]).to.match(/out center;/);
    });
  });

  // The reason tiles exist rather than caching by the drawn rectangle: two
  // different boundaries over the same ground must share fetches (§3.3).
  describe('tile cache reuse', () => {
    it('an overlapping second market makes fewer external calls', async () => {
      overpassStub.respondWith(respondWithStoresInBbox([]));

      const first = await newMarket();
      await runDiscovery(first);
      const callsForFirst = overpassStub.requestCount;
      expect(callsForFirst).to.be.greaterThan(0);

      overpassStub.reset();
      overpassStub.respondWith(respondWithStoresInBbox([]));

      // Shifted so it overlaps the first boundary without matching it.
      const second = await newMarket({
        minLat: 12.97,
        minLng: 77.6,
        maxLat: 12.99,
        maxLng: 77.62,
      });
      const outcome = await runDiscovery(second);

      expect(outcome.progress.tilesReused).to.be.greaterThan(0);
      expect(overpassStub.requestCount).to.be.lessThan(callsForFirst);
    });

    it('an identical second market makes no external calls at all', async () => {
      overpassStub.respondWith(respondWithStoresInBbox([]));
      await runDiscovery(await newMarket());

      overpassStub.reset();
      const outcome = await runDiscovery(await newMarket());

      expect(overpassStub.requestCount).to.equal(0);
      expect(outcome.progress.tilesFetched).to.equal(0);
      expect(outcome.progress.tilesReused).to.equal(
        outcome.progress.tilesTotal,
      );
    });

    // Freshness is enforced when the cache is read, so stale data is treated
    // exactly like missing data.
    it('re-fetches once the cached tiles go stale', async () => {
      overpassStub.respondWith(respondWithStoresInBbox([]));
      await runDiscovery(await newMarket());

      await ageTileFetches(30);
      overpassStub.reset();
      overpassStub.respondWith(respondWithStoresInBbox([]));

      const outcome = await runDiscovery(await newMarket());
      expect(outcome.progress.tilesReused).to.equal(0);
      expect(overpassStub.requestCount).to.be.greaterThan(0);
    });
  });

  describe('clipping to the exact boundary', () => {
    // Tiles are coarser than the drawn rectangle, so a store can be inside a
    // fetched tile yet outside the market.
    it('excludes a store that is inside a tile but outside the boundary', async () => {
      const justOutside = { id: 99, lat: 12.9805, lon: 77.6105 };
      overpassStub.respondWith(
        respondWithStoresInBbox([
          { id: 1, lat: 12.97, lon: 77.6 },
          justOutside,
        ]),
      );

      const marketId = await newMarket();
      const outcome = await runDiscovery(marketId);

      expect(await countStoresInsideBoundary(marketId)).to.equal(1);
      expect(outcome.progress.discoveredInBoundary).to.equal(1);
    });

    it('counts a store found in two tiles only once', async () => {
      // Sits on a tile edge, so it is returned by both adjacent fetches.
      overpassStub.respondWith((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            elements: [
              { type: 'node', id: 777, lat: 12.97, lon: 77.6, tags: {} },
            ],
          }),
        );
      });

      const marketId = await newMarket();
      const outcome = await runDiscovery(marketId);
      expect(outcome.progress.discoveredInBoundary).to.equal(1);
    });
  });

  describe('portfolio classification', () => {
    it('marks stores inside and outside the boundary', async () => {
      overpassStub.respondWith(respondWithStoresInBbox([]));

      await insertPortfolioStore({
        name: 'Inside Store',
        lat: 12.97,
        lng: 77.6,
      });
      await insertPortfolioStore({
        name: 'Outside Store',
        lat: 13.5,
        lng: 78.5,
      });

      const marketId = await newMarket();
      const outcome = await runDiscovery(marketId);

      expect(outcome.inside).to.equal(1);
      expect(outcome.outside).to.equal(1);
      expect(await portfolioClassification(marketId)).to.deep.equal([
        { store_name: 'Inside Store', is_inside: true },
        { store_name: 'Outside Store', is_inside: false },
      ]);
    });

    it('leaves an ungeocodable store unclassified rather than guessing', async () => {
      overpassStub.respondWith(respondWithStoresInBbox([]));
      // City must match the market's, or the pre-filter excludes the row and
      // the test would pass without exercising geocoding at all.
      await insertPortfolioStore({
        name: 'No Location',
        address: 'somewhere unresolvable',
        city: cityName,
      });

      const marketId = await newMarket();
      const outcome = await runDiscovery(marketId);

      expect(outcome.progress.geocodeCandidates).to.be.greaterThan(0);
      expect(await portfolioClassification(marketId)).to.deep.equal([]);
    });
  });

  // The pre-filter bounds API cost; it must never be what decides in or out.
  describe('geocoding candidate pre-filter', () => {
    // Previously excluded: NULL OR NULL is NULL, so the row failed the WHERE.
    // No region text is not evidence of being somewhere else (§3.2).
    it('includes a store with no city, state or country at all', async () => {
      overpassStub.respondWith(respondWithStoresInBbox([]));
      await insertPortfolioStore({
        name: 'No Region Fields',
        address: '12 MG Road',
      });

      const outcome = await runDiscovery(await newMarket());
      expect(outcome.progress.geocodeCandidates).to.equal(1);
    });

    it('includes a store whose city differs from the reference spelling', async () => {
      overpassStub.respondWith(respondWithStoresInBbox([]));
      await insertPortfolioStore({
        name: 'Loose Match',
        address: '12 MG Road',
        city: cityName.toUpperCase(),
      });

      const outcome = await runDiscovery(await newMarket());
      expect(outcome.progress.geocodeCandidates).to.equal(1);
    });

    // Already located rows have nothing to geocode.
    it('excludes a store that already has coordinates', async () => {
      overpassStub.respondWith(respondWithStoresInBbox([]));
      await insertPortfolioStore({
        name: 'Already Located',
        address: '12 MG Road',
        city: cityName,
        lat: 12.97,
        lng: 77.6,
      });

      const outcome = await runDiscovery(await newMarket());
      expect(outcome.progress.geocodeCandidates).to.equal(0);
    });

    // The bug this replaced: country was an OR term, and in a single-country
    // portfolio every row shares it, so the filter selected everything and
    // bounded nothing.
    it('excludes a store elsewhere in the same country', async () => {
      overpassStub.respondWith(respondWithStoresInBbox([]));
      await insertPortfolioStore({
        name: 'Far Away Same Country',
        address: '1 Some Street',
        city: 'Zzz Distant City',
        state: 'Zzz Distant State',
        country: 'India',
      });

      const outcome = await runDiscovery(await newMarket());
      expect(outcome.progress.geocodeCandidates).to.equal(0);
    });

    // Country only ever excludes: a different one is real evidence the store
    // is not here, even when the locality text happens to collide.
    it('excludes a store in a different country', async () => {
      overpassStub.respondWith(respondWithStoresInBbox([]));
      await insertPortfolioStore({
        name: 'Wrong Country',
        address: '1 Some Street',
        city: cityName,
        country: 'Canada',
      });

      const outcome = await runDiscovery(await newMarket());
      expect(outcome.progress.geocodeCandidates).to.equal(0);
    });

    it('still includes a matching city within the same country', async () => {
      overpassStub.respondWith(respondWithStoresInBbox([]));
      await insertPortfolioStore({
        name: 'Right Here',
        address: '12 MG Road',
        city: cityName,
        country: 'India',
      });

      const outcome = await runDiscovery(await newMarket());
      expect(outcome.progress.geocodeCandidates).to.equal(1);
    });
  });

  // A tile failure is isolated by design and never reaches BullMQ, so if it is
  // not retried here it is not retried at all.
  describe('tile-level retry', () => {
    it('retries a retryable failure and recovers', async () => {
      let call = 0;
      overpassStub.respondWith((req, res, body) => {
        call += 1;
        // Fail the very first attempt only; the retry should succeed.
        if (call === 1) return respondWithServerError(req, res, body);
        return respondWithStoresInBbox([])(req, res, body);
      });

      const marketId = await newMarket();
      const outcome = await runDiscovery(marketId);

      expect(outcome.progress.tilesFailed).to.equal(0);
      expect(outcome.progress.tilesFetched).to.equal(
        outcome.progress.tilesTotal,
      );
      // One extra call beyond the tile count: the retried attempt.
      expect(overpassStub.requestCount).to.equal(
        outcome.progress.tilesTotal + 1,
      );

      const status = await readStatus(marketId);
      expect(status.status).to.equal('completed');
      expect(status.error).to.equal(null);
    });

    // A 400 means the query itself is wrong; repeating it only burns the
    // fair-use budget.
    it('does not retry a permanent failure', async () => {
      overpassStub.respondWith(respondWithBadRequest);

      const marketId = await newMarket();
      const outcome = await runDiscovery(marketId);

      expect(overpassStub.requestCount).to.equal(outcome.progress.tilesTotal);
    });

    it('gives up after the configured attempts on a persistent retryable failure', async () => {
      overpassStub.respondWith(respondWithServerError);

      const marketId = await newMarket();
      const outcome = await runDiscovery(marketId);

      expect(outcome.progress.tilesFailed).to.equal(
        outcome.progress.tilesTotal,
      );
      expect(overpassStub.requestCount).to.equal(
        outcome.progress.tilesTotal * 3,
      );
    });
  });

  describe('failure handling', () => {
    // Partial failure must not lose the tiles that did succeed.
    it('completes with an error recorded when some tiles fail', async () => {
      let call = 0;
      overpassStub.respondWith((req, res, body) => {
        call += 1;
        // Permanent so it is not retried away, and only the first tile.
        if (call === 1) return respondWithBadRequest(req, res, body);
        return respondWithStoresInBbox([{ id: 5, lat: 12.97, lon: 77.6 }])(
          req,
          res,
          body,
        );
      });

      const marketId = await newMarket();
      const outcome = await runDiscovery(marketId);

      expect(outcome.progress.tilesFailed).to.be.greaterThan(0);
      expect(outcome.progress.tilesFetched).to.be.greaterThan(0);

      const status = await readStatus(marketId);
      expect(status.status).to.equal('completed');
      expect(status.error).to.match(/could not be fetched/);
    });

    // Total failure is reported as failed, not completed: with nothing fetched
    // and nothing reusable, an empty map would otherwise be indistinguishable
    // from a genuinely empty area.
    it('fails the market when every tile fails and nothing is cached', async () => {
      overpassStub.respondWith(respondWithBadRequest);

      const marketId = await newMarket();
      const outcome = await runDiscovery(marketId);

      expect(outcome.progress.tilesFetched).to.equal(0);
      expect(outcome.progress.tilesFailed).to.equal(
        outcome.progress.tilesTotal,
      );

      const status = await readStatus(marketId);
      expect(status.status).to.equal('failed');
      expect(status.error).to.be.a('string');
    });

    // A market stuck in `processing` would make the frontend poll forever, so
    // every path must land on a terminal status.
    it('never leaves the market in processing', async () => {
      overpassStub.respondWith(respondWithBadRequest);
      const marketId = await newMarket();
      await runDiscovery(marketId);

      const status = await readStatus(marketId);
      expect(['completed', 'failed']).to.include(status.status);
    });

    // Terminal state on the throw path belongs to the worker, which is the
    // only place that knows whether attempts remain. Writing `failed` here
    // would tell a polling client the market is done while a retry that may
    // well succeed is still pending.
    it('leaves terminal status to the worker when the run throws', async () => {
      // createMarket bypasses the route's area cap, so this boundary explodes
      // past the tile guard and makes discoverTiles throw.
      const marketId = await createMarket({
        cityId,
        categoryIds: [categoryId],
        boundary: { minLat: -80, minLng: -170, maxLat: 80, maxLng: 170 },
      });

      let threw = false;
      try {
        await runDiscovery(marketId);
      } catch {
        threw = true;
      }

      expect(threw).to.equal(true);
      const status = await readStatus(marketId);
      expect(status.status).to.equal('processing');
      expect(status.status).to.not.equal('failed');
    });

    it('does not cache a tile whose fetch failed', async () => {
      overpassStub.respondWith(respondWithBadRequest);
      await runDiscovery(await newMarket());

      overpassStub.reset();
      overpassStub.respondWith(respondWithStoresInBbox([]));
      const outcome = await runDiscovery(await newMarket());

      expect(outcome.progress.tilesReused).to.equal(0);
    });
  });

  // A geocoder outage must not look like a portfolio with nothing nearby.
  describe('geocoding visibility', () => {
    it('counts an unresolvable address separately from a service failure', async () => {
      overpassStub.respondWith(respondWithStoresInBbox([]));
      await insertPortfolioStore({
        name: 'Unresolvable',
        address: 'nowhere at all',
        city: cityName,
      });

      const marketId = await newMarket();
      const outcome = await runDiscovery(marketId);

      expect(outcome.progress.geocodeCandidates).to.be.greaterThan(0);
      expect(outcome.progress.geocodeUnresolved).to.be.greaterThan(0);
      expect(outcome.progress.geocodeFailed).to.equal(0);

      // An address the geocoder simply could not place is normal, so it is not
      // reported to the user as a fault.
      const status = await readStatus(marketId);
      expect(status.error).to.equal(null);
    });
  });

  describe('status and progress', () => {
    it('records progress and a completion timestamp', async () => {
      overpassStub.respondWith(respondWithStoresInBbox([]));
      const marketId = await newMarket();
      await runDiscovery(marketId);

      const status = await readStatus(marketId);
      expect(status.status).to.equal('completed');
      expect(status.last_discovered_at).to.not.equal(null);

      const progress = status.progress;
      if (!progress) throw new Error('progress was never written');
      expect(progress.tilesTotal).to.be.greaterThan(0);
      expect(progress.tilesFetched + progress.tilesReused).to.equal(
        progress.tilesTotal,
      );
    });
  });
});
