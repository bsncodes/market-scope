import { expect } from 'chai';
import { ErrorCode } from '../../src/types/error';
import {
  anyCityId,
  clearDiscoveryState,
  seedCategory,
  SMALL_BOUNDARY,
} from '../helpers/discoveryFixtures';
import { apiGet, apiPostJson } from '../helpers/testServer';

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

describe('market routes', () => {
  let cityId: number;
  let categoryId: number;

  before(async () => {
    cityId = await anyCityId();
    categoryId = await seedCategory('Route Supermarket', ['shop=supermarket']);
  });

  beforeEach(clearDiscoveryState);
  after(clearDiscoveryState);

  const createBody = (overrides: Record<string, unknown> = {}) => ({
    cityId,
    categoryIds: [categoryId],
    boundary: SMALL_BOUNDARY,
    ...overrides,
  });

  describe('POST /api/markets', () => {
    // 202, not 200: the row exists but discovery has only been queued.
    it('accepts the market and returns immediately without doing the work', async () => {
      const started = Date.now();
      const res = await apiPostJson<{
        market_id: number;
        status: string;
        area_sq_km: number;
      }>('/api/markets', createBody());

      expect(res.status).to.equal(202);
      expect(res.body.status).to.equal('queued');
      expect(res.body.market_id).to.be.a('number');
      expect(res.body.area_sq_km).to.be.greaterThan(0);
      expect(Date.now() - started).to.be.lessThan(1000);
    });

    it('reports the queued status straight after creation', async () => {
      const created = await apiPostJson<{ market_id: number }>(
        '/api/markets',
        createBody(),
      );
      const status = await apiGet<{ status: string; progress: unknown }>(
        `/api/markets/${created.body.market_id}/status`,
      );

      expect(status.status).to.equal(200);
      expect(status.body.status).to.equal('queued');
      expect(status.body.progress).to.equal(null);
    });

    // Enforced server-side as well as in the UI: the cap bounds how much work
    // one job can create, so it cannot be left to the client.
    it('rejects a boundary above the area cap', async () => {
      const res = await apiPostJson<ErrorBody>(
        '/api/markets',
        createBody({
          boundary: {
            minLat: 12.0,
            minLng: 77.0,
            maxLat: 13.0,
            maxLng: 78.0,
          },
        }),
      );

      expect(res.status).to.equal(400);
      expect(res.body.error.code).to.equal(ErrorCode.REQUEST_VALIDATION_FAILED);
      expect(res.body.error.message).to.match(/sq km/);
      expect(res.body.error.details?.area_sq_km).to.be.a('number');
    });

    it('rejects an inverted boundary rather than storing an empty polygon', async () => {
      const res = await apiPostJson<ErrorBody>(
        '/api/markets',
        createBody({
          boundary: {
            minLat: 12.98,
            minLng: 77.61,
            maxLat: 12.96,
            maxLng: 77.59,
          },
        }),
      );
      expect(res.status).to.equal(400);
      expect(res.body.error.message).to.match(/strictly less than/);
    });

    it('rejects out-of-range coordinates', async () => {
      const res = await apiPostJson<ErrorBody>(
        '/api/markets',
        createBody({
          boundary: { minLat: 12.96, minLng: 77.59, maxLat: 95, maxLng: 77.61 },
        }),
      );
      expect(res.status).to.equal(400);
      expect(res.body.error.message).to.match(/±90/);
    });

    it('rejects an empty category list', async () => {
      const res = await apiPostJson<ErrorBody>(
        '/api/markets',
        createBody({ categoryIds: [] }),
      );
      expect(res.status).to.equal(400);
      expect(res.body.error.message).to.match(/non-empty/);
    });

    it('404s for a city that does not exist', async () => {
      const res = await apiPostJson<ErrorBody>(
        '/api/markets',
        createBody({ cityId: 99999999 }),
      );
      expect(res.status).to.equal(404);
      expect(res.body.error.code).to.equal(ErrorCode.RESOURCE_NOT_FOUND);
    });

    it('400s for a category that does not exist', async () => {
      const res = await apiPostJson<ErrorBody>(
        '/api/markets',
        createBody({ categoryIds: [99999999] }),
      );
      expect(res.status).to.equal(400);
      expect(res.body.error.message).to.match(/categoryIds/);
    });
  });

  describe('GET /api/markets/:marketId/status', () => {
    it('404s for a market that does not exist', async () => {
      const res = await apiGet<ErrorBody>('/api/markets/99999999/status');
      expect(res.status).to.equal(404);
      expect(res.body.error.code).to.equal(ErrorCode.RESOURCE_NOT_FOUND);
    });

    it('400s on a non-numeric id', async () => {
      const res = await apiGet<ErrorBody>('/api/markets/abc/status');
      expect(res.status).to.equal(400);
      expect(res.body.error.code).to.equal(ErrorCode.REQUEST_VALIDATION_FAILED);
    });
  });
});
