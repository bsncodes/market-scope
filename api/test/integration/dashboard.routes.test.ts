import { expect } from 'chai';
import { runDiscovery } from '../../src/controllers/discovery';
import { createMarket } from '../../src/repositories/market';
import type { Bbox } from '../../src/types/discovery';
import {
  anyCity,
  clearDiscoveryState,
  insertPortfolioStore,
  seedCategory,
  SMALL_BOUNDARY,
} from '../helpers/discoveryFixtures';
import { overpassStub, respondWithStoresInBbox } from '../helpers/overpassStub';
import { apiGet, startTestServer } from '../helpers/testServer';

interface MarketDetailBody {
  market_id: number;
  status: string;
  error: string | null;
  last_discovered_at: string | null;
  progress: { tilesTotal: number; discoveredInBoundary: number } | null;
  boundary: Bbox;
  city: { id: number; name: string; state: string; country: string };
  categories: { id: number; label: string }[];
}

interface DiscoveredBody {
  market_id: number;
  count: number;
  stores: {
    id: string;
    name: string | null;
    category: string | null;
    lat: number;
    lng: number;
  }[];
}

interface PortfolioBody {
  market_id: number;
  inside_count: number;
  outside_count: number;
  stores: {
    id: number;
    name: string;
    category: string | null;
    address: string | null;
    is_inside: boolean;
    lat: number;
    lng: number;
  }[];
}

describe('dashboard read endpoints', () => {
  let cityId: number;
  let categoryId: number;

  before(async () => {
    cityId = (await anyCity()).id;
    categoryId = await seedCategory('Dashboard Supermarket', [
      'shop=supermarket',
    ]);
  });

  beforeEach(async () => {
    await clearDiscoveryState();
    overpassStub.reset();
  });

  after(clearDiscoveryState);

  const newMarket = (boundary: Bbox = SMALL_BOUNDARY) =>
    createMarket({ cityId, categoryIds: [categoryId], boundary });

  describe('GET /api/markets/:id', () => {
    it('returns the boundary, city and categories a dashboard needs', async () => {
      const marketId = await newMarket();

      const res = await apiGet<MarketDetailBody>(`/api/markets/${marketId}`);

      expect(res.status).to.equal(200);
      expect(res.body.market_id).to.equal(marketId);
      expect(res.body.status).to.equal('queued');
      expect(res.body.boundary).to.deep.equal(SMALL_BOUNDARY);
      expect(res.body.city.id).to.equal(cityId);
      expect(res.body.city.name).to.be.a('string');
      expect(res.body.city.state).to.be.a('string');
      expect(res.body.city.country).to.be.a('string');
      expect(res.body.categories).to.deep.equal([
        { id: categoryId, label: 'Dashboard Supermarket' },
      ]);
    });

    // The "Discovered <date>" label reads this column; before a run there is
    // nothing to label, and the UI must be able to tell the difference.
    it('reports no discovery timestamp before the job runs', async () => {
      const marketId = await newMarket();

      const res = await apiGet<MarketDetailBody>(`/api/markets/${marketId}`);

      expect(res.body.last_discovered_at).to.equal(null);
      expect(res.body.progress).to.equal(null);
    });

    it('carries the timestamp and progress once discovery completes', async () => {
      overpassStub.respondWith(respondWithStoresInBbox([]));
      const marketId = await newMarket();
      await runDiscovery(marketId);

      const res = await apiGet<MarketDetailBody>(`/api/markets/${marketId}`);

      expect(res.body.status).to.equal('completed');
      expect(res.body.last_discovered_at).to.not.equal(null);
      expect(res.body.progress?.tilesTotal).to.be.greaterThan(0);
    });

    it('404s an unknown market', async () => {
      const res = await apiGet(`/api/markets/999999`);
      expect(res.status).to.equal(404);
    });

    it('rejects a non-numeric id rather than querying with NaN', async () => {
      const res = await apiGet(`/api/markets/abc`);
      expect(res.status).to.equal(400);
    });
  });

  describe('GET /api/markets/:id/discovered-stores', () => {
    it('returns the stores discovery found inside the boundary', async () => {
      overpassStub.respondWith(
        respondWithStoresInBbox([
          { id: 1, lat: 12.965, lon: 77.595, tags: { name: 'Alpha Mart' } },
          { id: 2, lat: 12.975, lon: 77.605, tags: { name: 'Beta Mart' } },
        ]),
      );
      const marketId = await newMarket();
      await runDiscovery(marketId);

      const res = await apiGet<DiscoveredBody>(
        `/api/markets/${marketId}/discovered-stores`,
      );

      expect(res.status).to.equal(200);
      expect(res.body.count).to.equal(2);
      expect(res.body.stores.map((s) => s.name).sort()).to.deep.equal([
        'Alpha Mart',
        'Beta Mart',
      ]);
    });

    // The list view renders name + category straight from this payload, and
    // the map needs a position — a store missing either is not renderable.
    it('gives every store a name, a category and a position', async () => {
      overpassStub.respondWith(
        respondWithStoresInBbox([{ id: 1, lat: 12.965, lon: 77.595 }]),
      );
      const marketId = await newMarket();
      await runDiscovery(marketId);

      const store = (
        await apiGet<DiscoveredBody>(
          `/api/markets/${marketId}/discovered-stores`,
        )
      ).body.stores[0];

      expect(store.id).to.be.a('string');
      expect(store.category).to.equal('shop=supermarket');
      expect(store.lat).to.be.closeTo(12.965, 1e-6);
      expect(store.lng).to.be.closeTo(77.595, 1e-6);
    });

    // Tiles are deliberately over-inclusive, so the cache holds stores outside
    // the boundary. The read path must clip them or the dashboard shows pins
    // beyond the rectangle the user drew.
    it('excludes stores that fall outside the boundary', async () => {
      overpassStub.respondWith(
        respondWithStoresInBbox([
          { id: 1, lat: 12.965, lon: 77.595, tags: { name: 'Inside' } },
          { id: 2, lat: 12.9, lon: 77.5, tags: { name: 'Far Away' } },
        ]),
      );
      const marketId = await newMarket();
      await runDiscovery(marketId);

      const res = await apiGet<DiscoveredBody>(
        `/api/markets/${marketId}/discovered-stores`,
      );

      expect(res.body.stores.map((s) => s.name)).to.deep.equal(['Inside']);
    });

    // Another market's cached tiles are shared, but only for the categories
    // this market actually selected.
    it('excludes stores from a category this market did not select', async () => {
      const otherCategoryId = await seedCategory('Dashboard Pharmacy', [
        'amenity=pharmacy',
      ]);
      overpassStub.respondWith(
        respondWithStoresInBbox([
          { id: 1, lat: 12.965, lon: 77.595, tags: { name: 'Shared Tile' } },
        ]),
      );

      const pharmacyMarket = await createMarket({
        cityId,
        categoryIds: [otherCategoryId],
        boundary: SMALL_BOUNDARY,
      });
      await runDiscovery(pharmacyMarket);

      const supermarketMarket = await newMarket();
      const res = await apiGet<DiscoveredBody>(
        `/api/markets/${supermarketMarket}/discovered-stores`,
      );

      expect(res.body.count).to.equal(0);
    });

    it('returns an empty list for a market that found nothing', async () => {
      overpassStub.respondWith(respondWithStoresInBbox([]));
      const marketId = await newMarket();
      await runDiscovery(marketId);

      const res = await apiGet<DiscoveredBody>(
        `/api/markets/${marketId}/discovered-stores`,
      );

      expect(res.status).to.equal(200);
      expect(res.body.stores).to.deep.equal([]);
    });

    // An empty list would read as "discovery found nothing", which is a very
    // different thing to tell a user than "that market does not exist".
    it('404s an unknown market instead of returning an empty list', async () => {
      const res = await apiGet(`/api/markets/999999/discovered-stores`);
      expect(res.status).to.equal(404);
    });
  });

  describe('GET /api/markets/:id/portfolio', () => {
    it('returns both sides of the split with the flag and counts', async () => {
      overpassStub.respondWith(respondWithStoresInBbox([]));
      await insertPortfolioStore({
        name: 'Inside Store',
        lat: 12.97,
        lng: 77.6,
      });
      await insertPortfolioStore({
        name: 'Outside Store',
        lat: 12.5,
        lng: 77.2,
      });

      const marketId = await newMarket();
      await runDiscovery(marketId);

      const res = await apiGet<PortfolioBody>(
        `/api/markets/${marketId}/portfolio`,
      );

      expect(res.status).to.equal(200);
      expect(res.body.inside_count).to.equal(1);
      expect(res.body.outside_count).to.equal(1);

      const inside = res.body.stores.find((s) => s.is_inside);
      expect(inside?.name).to.equal('Inside Store');
      expect(inside?.category).to.equal('Supermarket');
      expect(inside?.lat).to.be.closeTo(12.97, 1e-6);
      expect(inside?.lng).to.be.closeTo(77.6, 1e-6);
    });

    // Nothing to plot and nothing to classify, so the layer stays empty rather
    // than the endpoint inventing a position.
    it('omits portfolio stores that were never located', async () => {
      overpassStub.respondWith(respondWithStoresInBbox([]));
      await insertPortfolioStore({ name: 'Located', lat: 12.97, lng: 77.6 });
      await insertPortfolioStore({ name: 'No Address At All' });

      const marketId = await newMarket();
      await runDiscovery(marketId);

      const res = await apiGet<PortfolioBody>(
        `/api/markets/${marketId}/portfolio`,
      );

      expect(res.body.stores.map((s) => s.name)).to.deep.equal(['Located']);
    });

    it('returns an empty split before discovery has classified anything', async () => {
      await insertPortfolioStore({
        name: 'Unclassified',
        lat: 12.97,
        lng: 77.6,
      });
      const marketId = await newMarket();

      const res = await apiGet<PortfolioBody>(
        `/api/markets/${marketId}/portfolio`,
      );

      expect(res.body.inside_count).to.equal(0);
      expect(res.body.outside_count).to.equal(0);
      expect(res.body.stores).to.deep.equal([]);
    });

    it('404s an unknown market', async () => {
      const res = await apiGet(`/api/markets/999999/portfolio`);
      expect(res.status).to.equal(404);
    });
  });

  // The Vite dev server is a different origin, so without this the browser
  // rejects every response before the app can read it.
  describe('CORS', () => {
    it('allows the frontend origin', async () => {
      const res = await fetch(`${await startTestServer()}/health`, {
        headers: { Origin: 'http://localhost:5173' },
      });

      expect(res.headers.get('access-control-allow-origin')).to.equal(
        'http://localhost:5173',
      );
    });

    it('does not allow an unlisted origin', async () => {
      const res = await fetch(`${await startTestServer()}/health`, {
        headers: { Origin: 'http://evil.example' },
      });

      expect(res.headers.get('access-control-allow-origin')).to.equal(null);
    });
  });
});
