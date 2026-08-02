import { expect } from 'chai';
import { config } from '../../src/config';
import { fetchStoresInBbox } from '../../src/controllers/overpass';
import type { Bbox } from '../../src/types/discovery';
import {
  overpassStub,
  respondWithBadRequest,
  respondWithRateLimit,
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

  // 429 is the server naming a rate limit, which is worth waiting out — unlike
  // a 400, where the query itself is the problem.
  it('retries a 429 rather than treating it as permanent', async () => {
    let call = 0;
    overpassStub.respondWith((req, res, body) => {
      call += 1;
      if (call === 1) return respondWithRateLimit(0)(req, res, body);
      return respondWithStores([{ id: 3, lat: 12.965, lon: 77.595 }])(
        req,
        res,
        body,
      );
    });

    const stores = await fetchStoresInBbox(BBOX, TAGS);
    expect(stores.length).to.equal(1);
    expect(overpassStub.requestCount).to.equal(2);
  });

  // Retrying on a locally-chosen delay when the server named one is how a
  // single 429 becomes a run of them, so the header has to win.
  it('waits at least as long as Retry-After asks', async function () {
    this.timeout(5000);
    const retryAfterSeconds = 0.4;
    let call = 0;
    overpassStub.respondWith((req, res, body) => {
      call += 1;
      if (call === 1) {
        return respondWithRateLimit(retryAfterSeconds)(req, res, body);
      }
      return respondWithStores([])(req, res, body);
    });

    const startedAt = Date.now();
    await fetchStoresInBbox(BBOX, TAGS);
    const waited = Date.now() - startedAt;

    // The configured backoff is 1ms under test, so a wait of this length can
    // only have come from the header.
    expect(waited).to.be.at.least(retryAfterSeconds * 1000 * 0.9);
  });

  // A header far longer than a market can afford to wait must not park the
  // whole run behind one tile.
  it('caps a Retry-After that exceeds the backoff ceiling', async function () {
    this.timeout(5000);
    let call = 0;
    overpassStub.respondWith((req, res, body) => {
      call += 1;
      if (call === 1) return respondWithRateLimit(3600)(req, res, body);
      return respondWithStores([])(req, res, body);
    });

    const startedAt = Date.now();
    await fetchStoresInBbox(BBOX, TAGS);
    const waited = Date.now() - startedAt;

    // An hour was asked for; the ceiling is what actually gets waited.
    expect(waited).to.be.lessThan(config.overpassMaxBackoffMs * 3);
    expect(overpassStub.requestCount).to.equal(2);
  });
});
