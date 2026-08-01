import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

// __dirname is api/src under tsx but api/dist/src once compiled, so walk up to
// find the repo-root .env rather than hardcoding a depth that only suits one.
function findEnvFile(from: string): string | undefined {
  let dir = from;
  for (;;) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

dotenv.config({ path: findEnvFile(__dirname) });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env at the repo root ` +
        `(cp .env.example .env) and make sure it defines ${name}.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

function numeric(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number, got "${raw}".`);
  }
  return parsed;
}

export const config = {
  port: numeric('PORT', 3000),

  databaseUrl: required('DATABASE_URL'),
  redisUrl: optional('REDIS_URL', 'redis://localhost:6379'),

  nominatimBaseUrl: optional(
    'NOMINATIM_BASE_URL',
    'https://nominatim.openstreetmap.org',
  ),
  overpassBaseUrl: optional(
    'OVERPASS_BASE_URL',
    'https://overpass-api.de/api/interpreter',
  ),

  marketMaxAreaSqKm: numeric('MARKET_MAX_AREA_SQKM', 30),
  tileSizeKm: numeric('TILE_SIZE_KM', 1),
  discoveryFreshnessDays: numeric('DISCOVERY_FRESHNESS_DAYS', 5),
  redisCacheTtlDays: numeric('REDIS_CACHE_TTL_DAYS', 1),

  // Nominatim's usage policy is one request per second. Overpass has no fixed
  // published rate but throttles by slot availability, so it is paced too.
  nominatimMinIntervalMs: numeric('NOMINATIM_MIN_INTERVAL_MS', 1100),
  overpassMinIntervalMs: numeric('OVERPASS_MIN_INTERVAL_MS', 1000),
  overpassTimeoutSeconds: numeric('OVERPASS_TIMEOUT_SECONDS', 25),

  discoveryJobAttempts: numeric('DISCOVERY_JOB_ATTEMPTS', 3),
  discoveryJobBackoffMs: numeric('DISCOVERY_JOB_BACKOFF_MS', 5000),
} as const;
