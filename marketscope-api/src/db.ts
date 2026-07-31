import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { Pool, types } from 'pg';

// pg returns BIGINT (OID 20) as a string by default, since it can't be sure
// the value fits in a JS number's safe integer range. Every id/FK column in
// this schema is BIGINT, and we're nowhere near 2^53 rows, so parse them as
// numbers here rather than threading string ids through the whole app.
types.setTypeParser(20, (val) => parseInt(val, 10));

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
