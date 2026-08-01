import assert from 'node:assert/strict';
import { ErrorCode } from '../../src/types/error';
import { findSeedIds } from '../helpers/db';
import { apiGet } from '../helpers/testServer';

describe('location routes', () => {
  let ids: Awaited<ReturnType<typeof findSeedIds>>;

  before(async () => {
    ids = await findSeedIds();
  });

  describe('GET /api/location/countries', () => {
    it('returns the seeded countries', async () => {
      const res = await apiGet<{ iso_code: string }[]>(
        '/api/location/countries',
      );
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
      assert.ok(res.body.some((c) => c.iso_code === 'IN'));
    });
  });

  describe('GET /api/location/countries/:countryId/states', () => {
    it('returns states for that country', async () => {
      const res = await apiGet<{ id: number; name: string }[]>(
        `/api/location/countries/${ids.countryId}/states`,
      );
      assert.equal(res.status, 200);
      assert.ok(res.body.length > 0);
      assert.equal(typeof res.body[0].id, 'number');
      assert.equal(typeof res.body[0].name, 'string');
    });

    // An empty array would read as "this country has no states" rather than
    // "this country does not exist".
    it('404s for a country that does not exist', async () => {
      const res = await apiGet<{ error: { code: string } }>(
        '/api/location/countries/99999999/states',
      );
      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, ErrorCode.RESOURCE_NOT_FOUND);
    });

    it('400s on a non-numeric id', async () => {
      const res = await apiGet<{ error: { code: string } }>(
        '/api/location/countries/abc/states',
      );
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, ErrorCode.REQUEST_VALIDATION_FAILED);
    });
  });

  describe('GET /api/location/states/:stateId/cities', () => {
    it('returns cities for the requested state', async () => {
      const res = await apiGet<unknown[]>(
        `/api/location/states/${ids.stateId}/cities`,
      );
      assert.equal(res.status, 200);
      assert.ok(res.body.length > 0);
    });

    // The cascade is the point of these endpoints: a city must never surface
    // under the wrong parent.
    it('does not leak cities between states', async () => {
      const [first, second] = await Promise.all([
        apiGet<{ id: number }[]>(`/api/location/states/${ids.stateId}/cities`),
        apiGet<{ id: number }[]>(
          `/api/location/states/${ids.otherStateId}/cities`,
        ),
      ]);

      const firstIds = new Set(first.body.map((c) => c.id));
      const overlap = second.body.filter((c) => firstIds.has(c.id));
      assert.equal(overlap.length, 0);
    });

    it('404s for a state that does not exist', async () => {
      const res = await apiGet('/api/location/states/99999999/cities');
      assert.equal(res.status, 404);
    });
  });

  describe('unknown routes', () => {
    it('are distinguishable from a missing resource', async () => {
      const res = await apiGet<{ error: { code: string } }>(
        '/api/does-not-exist',
      );
      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, ErrorCode.ROUTE_NOT_FOUND);
    });
  });
});

describe('category routes', () => {
  it('returns id and label', async () => {
    const res =
      await apiGet<{ id: number; label: string }[]>('/api/categories');
    assert.equal(res.status, 200);
    assert.ok(res.body.length > 0);
    assert.equal(typeof res.body[0].id, 'number');
    assert.equal(typeof res.body[0].label, 'string');
  });

  // `value` holds OSM tag expressions, an internal discovery detail.
  it('never exposes the OSM tag expressions', async () => {
    const res = await apiGet<Record<string, unknown>[]>('/api/categories');
    for (const category of res.body) {
      assert.deepEqual(Object.keys(category).sort(), ['id', 'label']);
    }
  });
});
