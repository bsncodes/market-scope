# Technical specification

The contract-level detail: schema, endpoints, configuration, and the rules
that are enforced rather than assumed. For _why_ any of it looks like this,
see [the decision records](decisions/).

## Stack

|          |                                                            |
| -------- | ---------------------------------------------------------- |
| API      | Node 22+, TypeScript, Express 5                            |
| Worker   | Same process image, separate entry point (`src/worker.ts`) |
| Database | PostgreSQL 16 + PostGIS 3.4                                |
| Queue    | BullMQ on Redis 7                                          |
| Frontend | Vite, React 19, React Router 7, Leaflet, `@turf/area`      |
| Tests    | Mocha + Chai (api), Vitest + React Testing Library (app)   |
| Tooling  | Prettier, oxlint, node-pg-migrate                          |

npm workspaces. One `npm install` at the root covers both packages.

## Schema

Eight numbered migrations in `api/migrations/`, applied in order. Schema
changes only ever happen through a new migration.

### Reference data

`country`, `state`, `city` — seeded from the `country-state-city` package for
India. `city` also carries a bounding box (`min_lat`, `min_lng`, `max_lat`,
`max_lng`), populated lazily from Nominatim the first time a city is used and
kept thereafter.

Three CHECK constraints guard the bbox, added in migration 007:

- `city_bbox_all_or_none` — all four columns or none. They are written
  together from one Nominatim response, so a partial row is always a bug and
  makes "is this city cached?" unanswerable.
- `city_bbox_in_range` — latitudes within ±90, longitudes within ±180.
- `city_bbox_ordered` — minimums below maximums.

### `category`

```sql
id     BIGSERIAL PRIMARY KEY
label  TEXT NOT NULL UNIQUE      -- "Pharmacy"
value  TEXT[] NOT NULL           -- {'amenity=pharmacy','shop=chemist'}
```

A category is a display label plus one or more OSM tag expressions. Widening
what counts as a pharmacy is a data change, not a deploy.

### `market`

```sql
id                 BIGSERIAL PRIMARY KEY
city_id            BIGINT NOT NULL REFERENCES city(id) ON DELETE RESTRICT
boundary           geometry(POLYGON, 4326) NOT NULL
status             TEXT NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued','processing','completed','failed'))
error              TEXT
progress           JSONB
last_discovered_at TIMESTAMPTZ
created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
CONSTRAINT market_boundary_valid CHECK (ST_IsValid(boundary))
```

`last_discovered_at` is separate from `updated_at` on purpose. The trigger
bumps `updated_at` on any change, so it cannot mean "how old is this data".
The dashboard's _Discovered &lt;date&gt;_ label reads the former.

`progress` is a JSONB projection the frontend polls — see
[Status response](#status-response).

`market_category` is the join to `category`, cascading from `market` and
restricted on `category` (a category in use cannot be deleted out from under a
market).

### `portfolio_store`

```sql
id         BIGSERIAL PRIMARY KEY
store_name TEXT NOT NULL
address    TEXT
city       TEXT
state      TEXT
country    TEXT
category   TEXT
location   geography(POINT, 4326)     -- NULL until geocoded
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

Free text for city/state/country, deliberately — a CSV says "Bengaluru" or
"Bangalore" and both should import. Matching against reference data is done
fuzzily during geocoding rather than enforced at insert.

`portfolio_store_market(market_id, portfolio_store_id, is_inside)` holds the
classification, cascading on both sides. See
[ADR-0008](decisions/0008-reclassify-markets-on-upload.md) for what that
cascade cost.

### Caching tables

```sql
geocode_cache(normalized_address TEXT UNIQUE, location geography(POINT,4326))
tile_fetch(tile_key TEXT, category_id BIGINT, fetched_at TIMESTAMPTZ,
           UNIQUE (tile_key, category_id))
discovered_store(tile_fetch_id BIGINT REFERENCES tile_fetch ON DELETE CASCADE,
                 osm_element_id TEXT, name TEXT, category_value TEXT,
                 location geography(POINT,4326),
                 UNIQUE (tile_fetch_id, osm_element_id))
```

`osm_element_id` is namespaced by type — `node/123`, `way/456` — because OSM
ids are only unique within a type. Collapsing them would silently drop one of
a node and a way that happen to share a number.

## HTTP API

Everything under `/api`. Errors are uniform:

```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "No market with id 9.",
    "details": {}
  }
}
```

`code` is an enum, not free text. `RESOURCE_VALIDATION_FAILED` is not
`REQUEST_VALIDATION_FAILED` — one means the request was malformed, the other
that its contents were rejected, and they carry different status codes.

### Reference data

| Method | Path                             | Notes                                                        |
| ------ | -------------------------------- | ------------------------------------------------------------ |
| GET    | `/location/countries`            |                                                              |
| GET    | `/location/countries/:id/states` | 404s on an unknown country rather than returning `[]`        |
| GET    | `/location/states/:id/cities`    | same                                                         |
| GET    | `/location/cities/:id/bbox`      | cached on the city row; falls through to Nominatim on a miss |
| GET    | `/categories`                    | label and id only — never the OSM tag expressions            |

### Portfolio

| Method | Path                 | Notes                                       |
| ------ | -------------------- | ------------------------------------------- |
| POST   | `/portfolio/upload`  | multipart, field `file`. 5 MB cap, CSV only |
| GET    | `/portfolio`         | current rows, `limit` 1–1000, default 200   |
| GET    | `/portfolio/summary` | `{ total, located }`                        |

Upload returns `201`:

```json
{
  "imported": 112,
  "with_coordinates": 102,
  "awaiting_geocoding": 10,
  "reclassified_markets": 3
}
```

Required columns: `store_name`, `address`, `city`, `state`, `country`,
`category`. Optional: `latitude`, `longitude`.

Row rules, all of which reject the entire file:

- `store_name` is required and non-empty.
- `latitude` and `longitude` must both be present or both absent.
- Coordinates must parse as numbers.
- `address` is required when coordinates are absent — a row with neither can
  never be placed.

Rejection reports **every** bad row, capped at 50, with the real source line
number:

```json
{
  "error": {
    "code": "RESOURCE_VALIDATION_FAILED",
    "message": "File rejected: 4 invalid rows. No stores were imported.",
    "details": {
      "error_count": 4,
      "truncated": false,
      "errors": [
        {
          "row": 2,
          "column": "store_name",
          "message": "store_name is required and cannot be empty."
        }
      ]
    }
  }
}
```

The line number comes from the parser's own accounting, not from the array
index — blank lines are skipped during parsing, so an index-derived number
drifts.

### Markets

| Method | Path                             | Notes                                          |
| ------ | -------------------------------- | ---------------------------------------------- |
| POST   | `/markets`                       | `202` with `market_id`, `status`, `area_sq_km` |
| GET    | `/markets`                       | newest first, `limit` 1–100, default 25        |
| GET    | `/markets/:id`                   | boundary, city, categories, status             |
| GET    | `/markets/:id/status`            | for polling                                    |
| GET    | `/markets/:id/discovered-stores` | clipped and deduped                            |
| GET    | `/markets/:id/portfolio`         | both sides with `is_inside` and counts         |

Create validates the city and categories exist, then measures the boundary
server-side with `ST_Area(...::geography)` and rejects anything over
`MARKET_MAX_AREA_SQKM`. The client enforces the same cap; the server is what
makes it a rule.

An unknown market id **404s** on every read, including the list endpoints. An
empty array would read as "discovery found nothing", which is a very different
thing to tell a user.

### Status response

```json
{
  "market_id": 7,
  "status": "completed",
  "error": "17 areas could not be fetched, so some stores may be missing.",
  "last_discovered_at": "2026-08-02T16:13:10.195Z",
  "progress": {
    "tilesTotal": 72,
    "tilesFetched": 52,
    "tilesReused": 0,
    "tilesFailed": 20,
    "geocodeCandidates": 0,
    "geocodeResolved": 0,
    "geocodeUnresolved": 0,
    "geocodeFailed": 0,
    "discoveredInBoundary": 112
  }
}
```

Those numbers are from a real run over central Bengaluru. Note that `status`
is `completed` while `error` is populated — a partial failure still produces a
usable map, and saying so is more useful than failing the whole market.

`geocodeUnresolved` and `geocodeFailed` are separate counters. One means bad
addresses, the other means the geocoder is down.

Progress is written at most every `PROGRESS_WRITE_INTERVAL_MS` (default 2 s).
The frontend polls every 10 s, so writing per tile would cost updates without
telling anyone anything sooner.

## Configuration

All of it in `.env`, read once into a typed object (`api/src/config.ts`).
Required variables throw at startup rather than surfacing as a confusing
runtime failure.

| Variable                       | Default                  | What it controls                                  |
| ------------------------------ | ------------------------ | ------------------------------------------------- |
| `DATABASE_URL`                 | —                        | required                                          |
| `REDIS_URL`                    | `redis://localhost:6379` |                                                   |
| `PORT`                         | 3000                     |                                                   |
| `CORS_ORIGINS`                 | `http://localhost:5173`  | comma-separated allow-list                        |
| `MARKET_MAX_AREA_SQKM`         | 30                       | the cap, enforced server-side                     |
| `TILE_SIZE_KM`                 | 1.5                      | grid resolution                                   |
| `DISCOVERY_FRESHNESS_DAYS`     | 5                        | when a tile goes stale                            |
| `NOMINATIM_RATE_PER_SECOND`    | 0.9                      | deliberately under 1.0                            |
| `NOMINATIM_BURST`              | 1                        | any burst breaches the policy                     |
| `OVERPASS_RATE_PER_SECOND`     | 0.25                     | see [ADR-0007](decisions/0007-overpass-pacing.md) |
| `OVERPASS_BURST`               | 1                        | leaves one of two slots free                      |
| `OVERPASS_TIMEOUT_SECONDS`     | 60                       | server-side query budget                          |
| `OVERPASS_TILE_ATTEMPTS`       | 3                        | per tile, in-process                              |
| `OVERPASS_TILE_RETRY_DELAY_MS` | 4000                     | base for exponential backoff                      |
| `OVERPASS_MAX_BACKOFF_MS`      | 30000                    | caps even a server-sent `Retry-After`             |
| `OVERPASS_ELEMENT_TYPES`       | `node,way,relation`      | drop `relation` when 504s bite                    |
| `DISCOVERY_JOB_ATTEMPTS`       | 3                        | whole-job retries                                 |
| `PROGRESS_WRITE_INTERVAL_MS`   | 2000                     |                                                   |
| `TEST_DATABASE_URL`            | —                        | **integration tests refuse to run without it**    |

That last one exists because the integration suite `DELETE`s from
`portfolio_store`, `market` and the caches, and once destroyed a working
development database. It now refuses unless pointed at something disposable.
CI sets `CI=true` and provisions a fresh database per run, so it is exempt.

## Testing

| Suite           | Count | Command                                    |
| --------------- | ----- | ------------------------------------------ |
| API unit        | 77    | `npm run test:unit --workspace api`        |
| API integration | 94    | `npm run test:integration --workspace api` |
| Frontend        | 65    | `npm test --workspace app`                 |

`npm test` at the root runs all three.

Unit tests need nothing running. Integration tests need PostGIS and Redis and
a `TEST_DATABASE_URL`; they stub Overpass and Nominatim with local HTTP
servers, so no test ever touches a rate-limited public service.

The suites have been mutation-tested in places — the `Retry-After` handling,
the token bucket's clamp and FIFO ordering, the CSV line-number derivation and
the `ST_MakePoint` argument order were each broken deliberately to confirm the
relevant test failed. Two tests were found passing vacuously that way.
