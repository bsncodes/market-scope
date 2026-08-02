import { expect } from 'chai';
import { runDiscovery } from '../../src/controllers/discovery';
import { createMarket } from '../../src/repositories/market';
import type { Bbox } from '../../src/types/discovery';
import {
  anyCity,
  clearDiscoveryFixtures,
  clearDiscoveryState,
  insertPortfolioStore,
  pointAtDistance,
  seedCategory,
  SMALL_BOUNDARY,
} from '../helpers/discoveryFixtures';
import { overpassStub, respondWithStoresInBbox } from '../helpers/overpassStub';
import { apiGet, apiUpload, startTestServer } from '../helpers/testServer';

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
  match_radius_m: number;
  inside_count: number;
  outside_count: number;
  matched_count: number;
  stores: {
    id: number;
    name: string;
    category: string | null;
    address: string | null;
    is_inside: boolean;
    lat: number;
    lng: number;
    matched: boolean;
    match_distance_m: number | null;
    matched_osm_id: string | null;
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

  after(clearDiscoveryFixtures);

  const newMarket = (boundary: Bbox = SMALL_BOUNDARY) =>
    createMarket({ cityId, categoryIds: [categoryId], boundary });

  describe('GET /api/markets', () => {
    interface ListBody {
      count: number;
      limit: number;
      markets: {
        id: number;
        status: string;
        area_sq_km: number;
        city: { name: string };
        categories: { id: number; label: string }[];
        discovered_count: number | null;
        portfolio_inside: number;
        portfolio_outside: number;
        created_at: string;
      }[];
    }

    it('lists a created market with enough to decide whether to reopen it', async () => {
      const marketId = await newMarket();

      const res = await apiGet<ListBody>('/api/markets');

      expect(res.status).to.equal(200);
      const market = res.body.markets.find((m) => m.id === marketId);
      expect(market, 'created market missing from the list').to.not.equal(
        undefined,
      );
      expect(market?.status).to.equal('queued');
      expect(market?.city.name).to.be.a('string');
      expect(market?.categories).to.deep.equal([
        { id: categoryId, label: 'Dashboard Supermarket' },
      ]);
      expect(market?.area_sq_km).to.be.greaterThan(0);
    });

    // Reopening the market you just made is the common case, so it has to be
    // at the top rather than buried under everything older.
    it('returns newest first', async () => {
      const older = await newMarket();
      const newer = await newMarket();

      const ids = (await apiGet<ListBody>('/api/markets')).body.markets.map(
        (m) => m.id,
      );

      expect(ids.indexOf(newer)).to.be.lessThan(ids.indexOf(older));
    });

    // Recounting inside the boundary for every row would make listing markets
    // cost more the more markets exist, so it reads the stored progress.
    it('carries the discovered count and portfolio split after a run', async () => {
      overpassStub.respondWith(
        respondWithStoresInBbox([
          { id: 1, lat: 12.965, lon: 77.595, tags: { name: 'Found' } },
        ]),
      );
      await insertPortfolioStore({ name: 'Inside', lat: 12.97, lng: 77.6 });
      await insertPortfolioStore({ name: 'Outside', lat: 12.5, lng: 77.2 });

      const marketId = await newMarket();
      await runDiscovery(marketId);

      const market = (await apiGet<ListBody>('/api/markets')).body.markets.find(
        (m) => m.id === marketId,
      );

      expect(market?.status).to.equal('completed');
      expect(market?.discovered_count).to.equal(1);
      expect(market?.portfolio_inside).to.equal(1);
      expect(market?.portfolio_outside).to.equal(1);
    });

    // A market that has never run has no progress to read, and reporting 0
    // would claim discovery found nothing rather than that it has not run.
    it('reports an unknown discovered count as null before a run', async () => {
      await newMarket();

      const market = (await apiGet<ListBody>('/api/markets')).body.markets[0];

      expect(market.discovered_count).to.equal(null);
      expect(market.portfolio_inside).to.equal(0);
    });

    it('returns an empty list rather than failing when nothing exists', async () => {
      const res = await apiGet<ListBody>('/api/markets');
      expect(res.status).to.equal(200);
      expect(res.body.markets).to.deep.equal([]);
    });

    it('honours a limit', async () => {
      await newMarket();
      await newMarket();
      await newMarket();

      const res = await apiGet<ListBody>('/api/markets?limit=2');

      expect(res.body.markets.length).to.equal(2);
      expect(res.body.limit).to.equal(2);
    });

    it('rejects a limit outside the allowed range', async () => {
      expect((await apiGet('/api/markets?limit=0')).status).to.equal(400);
      expect((await apiGet('/api/markets?limit=500')).status).to.equal(400);
      expect((await apiGet('/api/markets?limit=abc')).status).to.equal(400);
    });
  });

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

    // portfolio_store_market cascades from portfolio_store, so replacing the
    // portfolio used to wipe the split of every market created before it —
    // silently, since the market and its discovered stores survived and only
    // the two portfolio layers went blank.
    it('survives a portfolio re-upload', async () => {
      overpassStub.respondWith(respondWithStoresInBbox([]));
      await insertPortfolioStore({ name: 'Original', lat: 12.97, lng: 77.6 });

      const marketId = await newMarket();
      await runDiscovery(marketId);
      expect(
        (await apiGet<PortfolioBody>(`/api/markets/${marketId}/portfolio`)).body
          .inside_count,
      ).to.equal(1);

      const csv = [
        'store_name,address,city,state,country,category,latitude,longitude',
        'Replacement Inside,Somewhere,Bengaluru,Karnataka,India,Supermarket,12.97,77.6',
        'Replacement Outside,Elsewhere,Bengaluru,Karnataka,India,Supermarket,12.5,77.2',
      ].join('\n');
      const upload = await apiUpload<{ reclassified_markets: number }>(
        '/api/portfolio/upload',
        Buffer.from(csv),
      );
      expect(upload.status).to.equal(201);
      expect(upload.body.reclassified_markets).to.be.greaterThan(0);

      const res = await apiGet<PortfolioBody>(
        `/api/markets/${marketId}/portfolio`,
      );
      expect(res.body.inside_count).to.equal(1);
      expect(res.body.outside_count).to.equal(1);
      expect(res.body.stores.map((store) => store.name).sort()).to.deep.equal([
        'Replacement Inside',
        'Replacement Outside',
      ]);
    });
  });

  // The bonus: does OSM already know about this shop? A match means a
  // discovered store sits within the radius, which is only expressible in
  // metres because both columns are geography (ADR-0002).
  describe('matching portfolio stores against discovered ones', () => {
    const HOME = { lat: 12.97, lng: 77.6 };

    /** Runs discovery with one discovered store `metres` east of HOME. */
    async function marketWithStoreAt(metres: number) {
      const neighbour = await pointAtDistance(HOME.lat, HOME.lng, metres);
      overpassStub.respondWith(
        respondWithStoresInBbox([
          {
            id: 42,
            lat: neighbour.lat,
            lon: neighbour.lng,
            tags: { name: 'Nilgiris' },
          },
        ]),
      );
      await insertPortfolioStore({ name: 'Ours', ...HOME });

      const marketId = await newMarket();
      await runDiscovery(marketId);
      return (await apiGet<PortfolioBody>(`/api/markets/${marketId}/portfolio`))
        .body;
    }

    it('matches a store just inside the radius', async () => {
      const body = await marketWithStoreAt(149);

      expect(body.matched_count).to.equal(1);
      expect(body.stores[0].matched).to.equal(true);
      expect(Number(body.stores[0].match_distance_m)).to.be.closeTo(149, 1);
      expect(body.stores[0].matched_osm_id).to.equal('node/42');
    });

    // Measured, not assumed: ST_DWithin is inclusive of the radius itself.
    it('matches a store at exactly the radius', async () => {
      const body = await marketWithStoreAt(150);

      expect(body.match_radius_m).to.equal(150);
      expect(body.stores[0].matched).to.equal(true);
    });

    it('does not match a store just outside the radius', async () => {
      const body = await marketWithStoreAt(151);

      expect(body.matched_count).to.equal(0);
      expect(body.stores[0].matched).to.equal(false);
      expect(body.stores[0].match_distance_m).to.equal(null);
      expect(body.stores[0].matched_osm_id).to.equal(null);
    });

    it('reports the nearest match when several are in range', async () => {
      const near = await pointAtDistance(HOME.lat, HOME.lng, 40);
      const far = await pointAtDistance(HOME.lat, HOME.lng, 140);
      overpassStub.respondWith(
        respondWithStoresInBbox([
          { id: 1, lat: far.lat, lon: far.lng, tags: { name: 'Far' } },
          { id: 2, lat: near.lat, lon: near.lng, tags: { name: 'Near' } },
        ]),
      );
      await insertPortfolioStore({ name: 'Ours', ...HOME });

      const marketId = await newMarket();
      await runDiscovery(marketId);

      const body = (
        await apiGet<PortfolioBody>(`/api/markets/${marketId}/portfolio`)
      ).body;
      expect(body.stores[0].matched_osm_id).to.equal('node/2');
      expect(Number(body.stores[0].match_distance_m)).to.be.closeTo(40, 1);
    });

    // A neighbouring market can pull a pharmacy into a tile this market also
    // covers. Matching against it would claim OSM knows about a supermarket
    // because there is a chemist next door.
    it('ignores a nearby store from a category this market did not select', async () => {
      const otherCategoryId = await seedCategory('Match Pharmacy', [
        'amenity=pharmacy',
      ]);
      const neighbour = await pointAtDistance(HOME.lat, HOME.lng, 50);
      overpassStub.respondWith(
        respondWithStoresInBbox([
          { id: 7, lat: neighbour.lat, lon: neighbour.lng },
        ]),
      );

      const pharmacyMarket = await createMarket({
        cityId,
        categoryIds: [otherCategoryId],
        boundary: SMALL_BOUNDARY,
      });
      await runDiscovery(pharmacyMarket);

      // The stub answers any query, so without this the supermarket run would
      // discover the same element again under its own category and the test
      // would pass for the wrong reason.
      overpassStub.respondWith(respondWithStoresInBbox([]));

      await insertPortfolioStore({ name: 'Ours', ...HOME });
      const supermarketMarket = await newMarket();
      await runDiscovery(supermarketMarket);

      const body = (
        await apiGet<PortfolioBody>(
          `/api/markets/${supermarketMarket}/portfolio`,
        )
      ).body;
      expect(body.matched_count).to.equal(0);
    });

    it('leaves an unmatched store reported as such rather than omitted', async () => {
      overpassStub.respondWith(respondWithStoresInBbox([]));
      await insertPortfolioStore({ name: 'Ours', ...HOME });

      const marketId = await newMarket();
      await runDiscovery(marketId);

      const body = (
        await apiGet<PortfolioBody>(`/api/markets/${marketId}/portfolio`)
      ).body;
      expect(body.stores).to.have.length(1);
      expect(body.stores[0].matched).to.equal(false);
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
