import path from 'node:path';
import dotenv from 'dotenv';
import { nominatimStub } from './helpers/nominatimStub';
import { overpassStub } from './helpers/overpassStub';

// Loaded via .mocharc "require", so this whole module executes before mocha
// loads any spec file — and therefore before config.ts reads the environment.
// dotenv does not overwrite variables that are already set, so the assignments
// below win. Nothing here may import app code, since that would pull in
// config.ts before the overrides are applied.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const NOMINATIM_STUB_PORT = 19730;
export const OVERPASS_STUB_PORT = 19731;

// No test may reach the real Nominatim or Overpass: both are rate limited and
// their answers would change underneath us.
process.env.NOMINATIM_BASE_URL = `http://127.0.0.1:${NOMINATIM_STUB_PORT}`;
process.env.OVERPASS_BASE_URL = `http://127.0.0.1:${OVERPASS_STUB_PORT}`;

// Pacing exists for the real services' fair-use limits. Against local stubs it
// would only make the suite slow, so raise the rate far above what any test
// needs. Rates must stay positive — the bucket rejects zero, which would
// otherwise mean "never refills".
process.env.NOMINATIM_RATE_PER_SECOND = '100000';
process.env.NOMINATIM_BURST = '100000';
process.env.OVERPASS_RATE_PER_SECOND = '100000';
process.env.OVERPASS_BURST = '100000';

// Retry behaviour is asserted, but the waiting between attempts is not — at
// the production delay a whole-market failure would exceed the test timeout.
process.env.OVERPASS_TILE_RETRY_DELAY_MS = '1';

// The Retry-After specs assert against this ceiling, so it has to be short
// enough to wait out in a test. Production keeps the 30s default.
process.env.OVERPASS_MAX_BACKOFF_MS = '600';
process.env.PROGRESS_WRITE_INTERVAL_MS = '0';

// Integration tests DELETE from portfolio_store, market and the caches. Point
// them at a throwaway database rather than whatever DATABASE_URL happens to
// be — which, during development, is the database holding your real data.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
} else if (!process.env.CI) {
  // CI provisions a disposable database per run and sets CI=true, so it is
  // exempt. Locally, refusing is the only thing that reliably prevents this:
  // the suite is destructive, and the damage is silent until someone reopens
  // a market and finds it empty.
  throw new Error(
    'Refusing to run destructive integration tests against DATABASE_URL.\n' +
      'Set TEST_DATABASE_URL to a throwaway database, e.g.\n' +
      '  TEST_DATABASE_URL=postgres://market_scope:market_scope@localhost:5432/market_scope_test',
  );
}

export const mochaHooks = {
  async beforeAll() {
    await nominatimStub.start(NOMINATIM_STUB_PORT);
    await overpassStub.start(OVERPASS_STUB_PORT);
  },

  async afterAll() {
    await nominatimStub.stop();
    await overpassStub.stop();
    const { stopTestServer } = require('./helpers/testServer');
    await stopTestServer();
    // Required lazily: src/db pulls in config.ts, which must not load until
    // the environment overrides above have been applied.
    const { pool } = require('../src/db');
    await pool.end();
    const { closeQueue } = require('../src/queue');
    await closeQueue();
  },
};
