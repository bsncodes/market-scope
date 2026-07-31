import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { Pool, types } from 'pg';

types.setTypeParser(20, (val) => parseInt(val, 10));

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env at the repo root ' +
      '(cp .env.example .env) and make sure it defines DATABASE_URL.',
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
