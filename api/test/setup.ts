import path from 'node:path';
import dotenv from 'dotenv';
import { nominatimStub } from './helpers/nominatimStub';

// Loaded via .mocharc "require", so this whole module executes before mocha
// loads any spec file — and therefore before config.ts reads the environment.
// dotenv does not overwrite variables that are already set, so the assignments
// below win. Nothing here may import app code, since that would pull in
// config.ts before the overrides are applied.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const NOMINATIM_STUB_PORT = 19730;

// No test may reach the real Nominatim: it is rate limited and its answers
// would change underneath us.
process.env.NOMINATIM_BASE_URL = `http://127.0.0.1:${NOMINATIM_STUB_PORT}`;

// Integration tests mutate portfolio_store and city bboxes. Set
// TEST_DATABASE_URL to run them against a throwaway database instead.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

export const mochaHooks = {
  async beforeAll() {
    await nominatimStub.start(NOMINATIM_STUB_PORT);
  },

  async afterAll() {
    await nominatimStub.stop();
    const { stopTestServer } = require('./helpers/testServer');
    await stopTestServer();
    // Required lazily: src/db pulls in config.ts, which must not load until
    // the environment overrides above have been applied.
    const { pool } = require('../src/db');
    await pool.end();
  },
};
