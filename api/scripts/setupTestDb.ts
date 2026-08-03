import { execFileSync } from 'node:child_process';
import path from 'node:path';
import dotenv from 'dotenv';
import { Client } from 'pg';

/**
 * Creates the throwaway database the integration suite insists on, then
 * migrates and seeds it.
 *
 * The suite refuses to run without TEST_DATABASE_URL because it DELETEs from
 * portfolio_store, market and the caches — it destroyed a working development
 * database once. That guard is right, but it left `npm test` failing on a
 * fresh clone until somebody found the createdb line further down the README.
 * One command is better than a footnote.
 */
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const apiRoot = path.resolve(__dirname, '..');

async function main(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Copy .env.example to .env, which has one.',
    );
  }

  const dbName = new URL(url).pathname.slice(1);
  if (!dbName) {
    throw new Error(`TEST_DATABASE_URL names no database: ${url}`);
  }

  // Connect to `postgres` rather than the target: CREATE DATABASE cannot run
  // from inside the database it is creating.
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';

  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName],
    );

    if (rowCount === 0) {
      // CREATE DATABASE takes no bound parameters, and the name comes from a
      // URL the developer controls, so it is quoted rather than parameterised.
      await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
      console.log(`Created ${dbName}`);
    } else {
      console.log(`${dbName} already exists`);
    }
  } finally {
    await admin.end();
  }

  const env = { ...process.env, DATABASE_URL: url };
  const run = (command: string, args: string[]) =>
    execFileSync(command, args, { stdio: 'inherit', env, cwd: apiRoot });

  run('npx', ['node-pg-migrate', 'up']);
  run('npx', ['tsx', 'scripts/seed.ts']);

  console.log(`\n${dbName} is ready. npm test will now run everything.`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
