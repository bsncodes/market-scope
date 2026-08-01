import { expect } from 'chai';
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
      expect(res.status).to.equal(200);

      expect(res.body).to.deep.equal({
        min_lat: 12.8,
        min_lng: 77.4,
        max_lat: 13.1,
        max_lng: 77.8,
      });
      expect(nominatimStub.requestCount).to.equal(1);
    });

    // Nominatim returns [south, north, west, east]. Mapping that onto
    // min/max lat/lng positionally would transpose the box without erroring.
    it('maps Nominatim ordering onto min/max lat/lng correctly', async () => {
      nominatimStub.respondWith(
        respondWithBox({ south: 1, north: 2, west: 3, east: 4 }),
      );

      const res = await apiGet<any>(`/api/location/cities/${cityId}/bbox`);
      expect(res.status).to.equal(200);

      expect(res.body).to.deep.equal({
        min_lat: 1,
        max_lat: 2,
        min_lng: 3,
        max_lng: 4,
      });
    });

    it('queries using city, state and country', async () => {
      expect(
        (await apiGet(`/api/location/cities/${cityId}/bbox`)).status,
      ).to.equal(200);
      expect(nominatimStub.lastQuery).to.be.a('string');
      expect(nominatimStub.lastQuery).to.match(/India$/);
    });

    it('writes all four columns back onto the city row', async () => {
      expect(
        (await apiGet(`/api/location/cities/${cityId}/bbox`)).status,
      ).to.equal(200);

      const stored = await readCityBbox(cityId);
      for (const column of ['min_lat', 'min_lng', 'max_lat', 'max_lng']) {
        expect(stored[column], `${column} should be populated`).to.not.equal(
          null,
        );
      }
    });
  });

  describe('on a cache hit', () => {
    // The cache is the whole point of the endpoint: a repeat request must not
    // reach the upstream at all.
    it('makes no second upstream request', async () => {
      expect(
        (await apiGet(`/api/location/cities/${cityId}/bbox`)).status,
      ).to.equal(200);
      expect(nominatimStub.requestCount).to.equal(1);

      const second = await apiGet<any>(`/api/location/cities/${cityId}/bbox`);
      expect(second.status).to.equal(200);
      const third = await apiGet<any>(`/api/location/cities/${cityId}/bbox`);
      expect(third.status).to.equal(200);

      expect(
        nominatimStub.requestCount,
        'cached reads must not call the geocoder',
      ).to.equal(1);
      expect(second.body).to.deep.equal(third.body);
    });

    it('serves the cached value even when the upstream is failing', async () => {
      const first = await apiGet<any>(`/api/location/cities/${cityId}/bbox`);
      expect(first.status).to.equal(200);

      nominatimStub.respondWith(respondWithServerError);

      const cached = await apiGet<any>(`/api/location/cities/${cityId}/bbox`);
      expect(cached.status).to.equal(200);
      expect(cached.body).to.deep.equal(first.body);
    });
  });

  describe('upstream failures', () => {
    it('distinguishes "no result" from "service failed"', async () => {
      nominatimStub.respondWith(respondWithNoResults);
      const noResult = await apiGet<any>(`/api/location/cities/${cityId}/bbox`);
      expect(noResult.status).to.equal(404);
      expect(noResult.body.error.code).to.equal(ErrorCode.UPSTREAM_NO_RESULT);

      nominatimStub.respondWith(respondWithServerError);
      const failed = await apiGet<any>(`/api/location/cities/${cityId}/bbox`);
      expect(failed.status).to.equal(502);
      expect(failed.body.error.code).to.equal(
        ErrorCode.UPSTREAM_SERVICE_FAILED,
      );
    });

    it('rejects a bounding box that is not numeric', async () => {
      nominatimStub.respondWith(respondWithMalformedBox);
      const res = await apiGet<any>(`/api/location/cities/${cityId}/bbox`);
      expect(res.status).to.equal(502);
      expect(res.body.error.code).to.equal(ErrorCode.UPSTREAM_SERVICE_FAILED);
    });

    it('does not cache a failed lookup', async () => {
      nominatimStub.respondWith(respondWithServerError);
      expect(
        (await apiGet(`/api/location/cities/${cityId}/bbox`)).status,
      ).to.equal(502);

      const stored = await readCityBbox(cityId);
      expect(stored.min_lat).to.equal(null);
    });
  });

  describe('unknown city', () => {
    it('404s without calling the geocoder', async () => {
      const res = await apiGet<any>('/api/location/cities/99999999/bbox');
      expect(res.status).to.equal(404);
      expect(res.body.error.code).to.equal(ErrorCode.RESOURCE_NOT_FOUND);
      expect(nominatimStub.requestCount).to.equal(0);
    });
  });
});
