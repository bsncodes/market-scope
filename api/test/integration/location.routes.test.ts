import { expect } from 'chai';
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
      expect(res.status).to.equal(200);
      expect(res.body).to.be.an('array');
      expect(res.body.map((c) => c.iso_code)).to.include('IN');
    });
  });

  describe('GET /api/location/countries/:countryId/states', () => {
    it('returns states for that country', async () => {
      const res = await apiGet<{ id: number; name: string }[]>(
        `/api/location/countries/${ids.countryId}/states`,
      );
      expect(res.status).to.equal(200);
      expect(res.body.length).to.be.greaterThan(0);
      expect(typeof res.body[0].id).to.equal('number');
      expect(typeof res.body[0].name).to.equal('string');
    });

    // An empty array would read as "this country has no states" rather than
    // "this country does not exist".
    it('404s for a country that does not exist', async () => {
      const res = await apiGet<{ error: { code: string } }>(
        '/api/location/countries/99999999/states',
      );
      expect(res.status).to.equal(404);
      expect(res.body.error.code).to.equal(ErrorCode.RESOURCE_NOT_FOUND);
    });

    it('400s on a non-numeric id', async () => {
      const res = await apiGet<{ error: { code: string } }>(
        '/api/location/countries/abc/states',
      );
      expect(res.status).to.equal(400);
      expect(res.body.error.code).to.equal(ErrorCode.REQUEST_VALIDATION_FAILED);
    });
  });

  describe('GET /api/location/states/:stateId/cities', () => {
    it('returns cities for the requested state', async () => {
      const res = await apiGet<unknown[]>(
        `/api/location/states/${ids.stateId}/cities`,
      );
      expect(res.status).to.equal(200);
      expect(res.body.length).to.be.greaterThan(0);
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
      expect(overlap.length).to.equal(0);
    });

    it('404s for a state that does not exist', async () => {
      const res = await apiGet('/api/location/states/99999999/cities');
      expect(res.status).to.equal(404);
    });
  });

  describe('unknown routes', () => {
    it('are distinguishable from a missing resource', async () => {
      const res = await apiGet<{ error: { code: string } }>(
        '/api/does-not-exist',
      );
      expect(res.status).to.equal(404);
      expect(res.body.error.code).to.equal(ErrorCode.ROUTE_NOT_FOUND);
    });
  });
});

describe('category routes', () => {
  it('returns id and label', async () => {
    const res =
      await apiGet<{ id: number; label: string }[]>('/api/categories');
    expect(res.status).to.equal(200);
    expect(res.body.length).to.be.greaterThan(0);
    expect(typeof res.body[0].id).to.equal('number');
    expect(typeof res.body[0].label).to.equal('string');
  });

  // `value` holds OSM tag expressions, an internal discovery detail.
  it('never exposes the OSM tag expressions', async () => {
    const res = await apiGet<Record<string, unknown>[]>('/api/categories');
    for (const category of res.body) {
      expect(Object.keys(category).sort()).to.deep.equal(['id', 'label']);
    }
  });
});
