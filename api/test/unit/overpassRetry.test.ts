import { expect } from 'chai';
import { fetchStoresInBbox } from '../../src/controllers/overpass';
import type { Bbox } from '../../src/types/discovery';
import {
  overpassStub,
  respondWithBadRequest,
  respondWithServerError,
  respondWithStores,
} from '../helpers/overpassStub';

const BBOX: Bbox = {
  minLat: 12.96,
  minLng: 77.59,
  maxLat: 12.97,
  maxLng: 77.6,
};
const TAGS = [{ key: 'shop', value: 'supermarket' }];

/**
 * These exercise the HTTP stub only — no database — so they belong with the
 * unit suite. A tile failure is isolated by the caller and never reaches
 * BullMQ, so retrying here is the only retry a tile ever gets.
 */
describe('fetchStoresInBbox retry', () => {
  beforeEach(() => overpassStub.reset());

  it('returns on the first attempt when the call succeeds', async () => {
    overpassStub.respondWith(
      respondWithStores([{ id: 1, lat: 12.965, lon: 77.595 }]),
    );

    const stores = await fetchStoresInBbox(BBOX, TAGS);
    expect(stores.length).to.equal(1);
    expect(overpassStub.requestCount).to.equal(1);
  });

  it('retries a 5xx and returns the recovered result', async () => {
    let call = 0;
    overpassStub.respondWith((req, res, body) => {
      call += 1;
      if (call === 1) return respondWithServerError(req, res, body);
      return respondWithStores([{ id: 2, lat: 12.965, lon: 77.595 }])(
        req,
        res,
        body,
      );
    });

    const stores = await fetchStoresInBbox(BBOX, TAGS);
    expect(stores.length).to.equal(1);
    expect(overpassStub.requestCount).to.equal(2);
  });

  it('gives up after the configured attempts and throws', async () => {
    overpassStub.respondWith(respondWithServerError);

    let threw = false;
    try {
      await fetchStoresInBbox(BBOX, TAGS);
    } catch (err) {
      threw = true;
      expect((err as Error).message).to.match(/Overpass/);
    }

    expect(threw).to.equal(true);
    expect(overpassStub.requestCount).to.equal(3);
  });

  // A 400 means the query itself is malformed. Repeating it would fail
  // identically three times and spend fair-use budget for nothing.
  it('does not retry a 4xx', async () => {
    overpassStub.respondWith(respondWithBadRequest);

    let threw = false;
    try {
      await fetchStoresInBbox(BBOX, TAGS);
    } catch {
      threw = true;
    }

    expect(threw).to.equal(true);
    expect(overpassStub.requestCount).to.equal(1);
  });
});
