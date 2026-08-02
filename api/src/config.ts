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

  // The frontend runs on its own origin under Vite, so every browser request
  // is cross-origin and fails preflight without this. Comma-separated so a
  // deployed origin can be added without code changes.
  corsOrigins: optional('CORS_ORIGINS', 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

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

  // How close a discovered store has to be before we call it the same shop as
  // one of yours. 150 m is roughly a city block: far enough to absorb the
  // disagreement between a geocoded address and where OSM put the building,
  // close enough that two genuinely different shops on one street do not pair
  // up. Metres only work because both columns are geography — see ADR-0002.
  storeMatchRadiusM: numeric('STORE_MATCH_RADIUS_M', 150),
  tileSizeKm: numeric('TILE_SIZE_KM', 2),
  discoveryFreshnessDays: numeric('DISCOVERY_FRESHNESS_DAYS', 5),
  redisCacheTtlDays: numeric('REDIS_CACHE_TTL_DAYS', 1),

  // Token bucket per service: sustained rate plus how many calls may burst
  // before throttling begins.
  //
  // Nominatim's usage policy is an ABSOLUTE maximum of one request per second,
  // so its burst stays at 1 — any burst at all would breach it.
  //
  // The rate sits just under 1/sec rather than exactly on it. Running at the
  // ceiling leaves no room for timing jitter: a slow event loop tick or a GC
  // pause landing badly can place two requests inside the same wall-clock
  // second. 0.9/sec spaces them ~1.11s apart, which is the same margin the
  // earlier fixed 1100ms interval had.
  nominatimRatePerSecond: numeric('NOMINATIM_RATE_PER_SECOND', 0.9),
  nominatimBurst: numeric('NOMINATIM_BURST', 1),
  overpassRatePerSecond: numeric('OVERPASS_RATE_PER_SECOND', 0.25),
  overpassBurst: numeric('OVERPASS_BURST', 1),
  overpassTimeoutSeconds: numeric('OVERPASS_TIMEOUT_SECONDS', 60),

  // Tile failures are isolated per tile and never reach BullMQ, so a retryable
  // response has to be retried here or not at all.
  overpassTileAttempts: numeric('OVERPASS_TILE_ATTEMPTS', 3),
  overpassTileRetryDelayMs: numeric('OVERPASS_TILE_RETRY_DELAY_MS', 4000),

  // Ceiling on any single backoff, including one the server asked for. A
  // Retry-After of several minutes would otherwise stall a whole market
  // behind one tile.
  overpassMaxBackoffMs: numeric('OVERPASS_MAX_BACKOFF_MS', 30000),

  // Which OSM element types each tile query asks for. `relation` is by far the
  // most expensive clause to resolve with `out center`, so dropping it is the
  // lever to reach for when a loaded server is returning 504s — at the cost of
  // missing the rare shop mapped as a multipolygon.
  overpassElementTypes: optional('OVERPASS_ELEMENT_TYPES', 'node,way,relation')
    .split(',')
    .map((type) => type.trim())
    .filter(Boolean),

  // The poll loop reads every ~10s, so writing progress more often than this
  // costs updates without telling anyone anything sooner.
  progressWriteIntervalMs: numeric('PROGRESS_WRITE_INTERVAL_MS', 2000),

  discoveryJobAttempts: numeric('DISCOVERY_JOB_ATTEMPTS', 3),
  discoveryJobBackoffMs: numeric('DISCOVERY_JOB_BACKOFF_MS', 5000),
} as const;
