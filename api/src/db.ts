import { Pool, types } from 'pg';
import { config } from './config';

types.setTypeParser(20, (val) => parseInt(val, 10));

export const pool = new Pool({ connectionString: config.databaseUrl });
