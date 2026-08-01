import assert from 'node:assert/strict';
import { ErrorCode } from '../../src/types/error';
import { clearCityBbox, findSeedIds, readCityBbox } from '../helpers/db';
import {
  nominatimStub,
  respondWithBox,
  respondWithMalformedBox,
  respondWithNoResults,
  respondWithServerError,
} from '../helpers/nominatimStub';
import { apiGet } from '../helpers/testServer';

describe('GET /api/location/cities/:cityId/bbox', () => {
  let cityId: number;

  before(async () => {
    ({ cityId } = await findSeedIds());
  });

  beforeEach(async () => {
    nominatimStub.reset();
    await clearCityBbox(cityId);
  });

  after(async () => {
    await clearCityBbox(cityId);
  });

  describe('on a cache miss', () => {
    it('geocodes and returns the bounding box', async () => {
      nominatimStub.respondWith(
        respondWithBox({ south: 12.8, north: 13.1, west: 77.4, east: 77.8 }),
      );

      const res = await apiGet<any>(`/api/location/cities/${cityId}/bbox`);
      assert.equal(res.status, 200);

      assert.deepEqual(res.body, {
        min_lat: 12.8,
        min_lng: 77.4,
        max_lat: 13.1,
        max_lng: 77.8,
      });
      assert.equal(nominatimStub.requestCount, 1);
    });

    // Nominatim returns [south, north, west, east]. Mapping that onto
    // min/max lat/lng positionally would transpose the box without erroring.
    it('maps Nominatim ordering onto min/max lat/lng correctly', async () => {
      nominatimStub.respondWith(
        respondWithBox({ south: 1, north: 2, west: 3, east: 4 }),
      );

      const res = await apiGet<any>(`/api/location/cities/${cityId}/bbox`);
      assert.equal(res.status, 200);

      assert.deepEqual(res.body, {
        min_lat: 1,
        max_lat: 2,
        min_lng: 3,
        max_lng: 4,
      });
    });

    it('queries using city, state and country', async () => {
      assert.equal(
        (await apiGet(`/api/location/cities/${cityId}/bbox`)).status,
        200,
      );
      assert.ok(nominatimStub.lastQuery);
      assert.match(nominatimStub.lastQuery, /India$/);
    });

    it('writes all four columns back onto the city row', async () => {
      assert.equal(
        (await apiGet(`/api/location/cities/${cityId}/bbox`)).status,
        200,
      );

      const stored = await readCityBbox(cityId);
      for (const column of ['min_lat', 'min_lng', 'max_lat', 'max_lng']) {
        assert.notEqual(stored[column], null, `${column} should be populated`);
      }
    });
  });

  describe('on a cache hit', () => {
    // The cache is the whole point of the endpoint: a repeat request must not
    // reach the upstream at all.
    it('makes no second upstream request', async () => {
      assert.equal(
        (await apiGet(`/api/location/cities/${cityId}/bbox`)).status,
        200,
      );
      assert.equal(nominatimStub.requestCount, 1);

      const second = await apiGet<any>(`/api/location/cities/${cityId}/bbox`);
      assert.equal(second.status, 200);
      const third = await apiGet<any>(`/api/location/cities/${cityId}/bbox`);
      assert.equal(third.status, 200);

      assert.equal(
        nominatimStub.requestCount,
        1,
        'cached reads must not call the geocoder',
      );
      assert.deepEqual(second.body, third.body);
    });

    it('serves the cached value even when the upstream is failing', async () => {
      const first = await apiGet<any>(`/api/location/cities/${cityId}/bbox`);
      assert.equal(first.status, 200);

      nominatimStub.respondWith(respondWithServerError);

      const cached = await apiGet<any>(`/api/location/cities/${cityId}/bbox`);
      assert.equal(cached.status, 200);
      assert.deepEqual(cached.body, first.body);
    });
  });

  describe('upstream failures', () => {
    it('distinguishes "no result" from "service failed"', async () => {
      nominatimStub.respondWith(respondWithNoResults);
      const noResult = await apiGet<any>(`/api/location/cities/${cityId}/bbox`);
      assert.equal(noResult.status, 404);
      assert.equal(noResult.body.error.code, ErrorCode.UPSTREAM_NO_RESULT);

      nominatimStub.respondWith(respondWithServerError);
      const failed = await apiGet<any>(`/api/location/cities/${cityId}/bbox`);
      assert.equal(failed.status, 502);
      assert.equal(failed.body.error.code, ErrorCode.UPSTREAM_SERVICE_FAILED);
    });

    it('rejects a bounding box that is not numeric', async () => {
      nominatimStub.respondWith(respondWithMalformedBox);
      const res = await apiGet<any>(`/api/location/cities/${cityId}/bbox`);
      assert.equal(res.status, 502);
      assert.equal(res.body.error.code, ErrorCode.UPSTREAM_SERVICE_FAILED);
    });

    it('does not cache a failed lookup', async () => {
      nominatimStub.respondWith(respondWithServerError);
      assert.equal(
        (await apiGet(`/api/location/cities/${cityId}/bbox`)).status,
        502,
      );

      const stored = await readCityBbox(cityId);
      assert.equal(stored.min_lat, null);
    });
  });

  describe('unknown city', () => {
    it('404s without calling the geocoder', async () => {
      const res = await apiGet<any>('/api/location/cities/99999999/bbox');
      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, ErrorCode.RESOURCE_NOT_FOUND);
      assert.equal(nominatimStub.requestCount, 0);
    });
  });
});
