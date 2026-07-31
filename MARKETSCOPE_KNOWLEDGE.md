# MarketScope — Project Knowledge & Build Handoff

> Handoff document for building MarketScope. It captures the problem, the
> architecture decisions already made (and *why*), the database schema, and the
> remaining build plan. Read this top to bottom before writing code.

---

## 1. What we're building

MarketScope helps a retail/CPG business see where its own stores ("portfolio")
sit relative to the broader universe of retail outlets in a city, and which
outlets are worth targeting. This is one self-contained workflow:

**Upload your stores → define a market boundary on a map → discover other stores
inside it → visualize everything on a dashboard.**

### The four-step functional flow

1. **Portfolio Upload** — user uploads a CSV/XLSX of their own stores. Validate
   before accepting; surface clear errors. Columns: `store_name, address, city,
   state, country, category, latitude (optional), longitude (optional)`.
2. **Market Setup** — user selects Country → State → City (seeded dropdowns, not
   free text), multi-selects categories, and gets an auto-generated rectangular
   boundary (bounding box) on a map that they can drag/resize. Show live area in
   sq km; cap at **30 sq km**; disable "Create Market" above the cap.
3. **Market Creation** — on submit: geocode portfolio rows missing lat/long that
   fall within the boundary; discover stores inside the boundary filtered to the
   selected categories via a places API; persist everything against the market.
4. **Market Dashboard** — map with **three independently toggleable layers**
   (discovered stores / portfolio inside boundary / portfolio outside boundary)
   plus a list view (name + category minimum) beside the map.

### Bonus (only if core is clean)

Store matching: for each portfolio store, check if a discovered store exists
within **150 meters**; if so mark "matched" and add a 4th map layer. Do NOT do
this at the expense of a clean core.

### What's being evaluated

Architecture & separation of concerns; code quality; **real third-party API
handling** (rate limits, pagination, partial failures, retries, cost awareness);
data modeling; tests (especially boundary filtering, header validation, geo
logic); UX judgment. The bar is on code you can *explain and defend*, not just
code that compiles. Time box: 2–3 days. **A clean smaller core beats a rushed
everything.**

---

## 2. Tech stack (decided)

- **Monorepo** — `/frontend` and `/backend`, single clone, single README. Keep it
  simple (no Nx/Turborepo needed).
- **Frontend** — Vite + React.
- **Backend** — Node.js / JavaScript.
- **Database** — PostgreSQL **with PostGIS** (spatial types, `ST_Contains`,
  `ST_DWithin`, GiST indexes).
- **Cache / queue** — Redis (hot cache + BullMQ backing).
- **Async jobs** — BullMQ.
- **Maps (frontend)** — Leaflet or Google Maps JS (choice open); use turf.js for
  area calculation.
- **Places / discovery** — **OpenStreetMap Overpass** (free, no billing).
- **Geocoding** — **OpenStreetMap Nominatim** (free).

### Why OSM/Overpass over Google Places

Free, no billing/API key (removes the biggest setup blocker for a take-home).
Its bounding-box query model ("give me everything in this bbox") fits the
broad-fetch/tiling cache design naturally. Trade-offs to note in README: OSM
coverage/tagging quality varies (community-contributed); public Overpass has
fair-use rate limits; would consider Google Places for a commercial product for
better coverage, accepting billing + token pagination complexity.

---

## 3. Core architecture decisions (with rationale)

These are the decisions to defend in a follow-up conversation. Each has a *why*.

### 3.1 Two kinds of data with different lifetimes

- **Geocode data** = address → coordinates. **Immutable** (an address's
  coordinates never change). Cache **forever**, never expire, never delete.
  Source: Nominatim.
- **Discovered data** = the stores found in an area. **Mutable** (stores open /
  close). Cache with a **freshness window** and re-fetch when stale. Source:
  Overpass.

This distinction drives separate tables and separate cleanup rules. It's the
single most important modeling idea in the project.

### 3.2 Caching layers

- **Postgres = durable source of truth** for everything worth keeping (geocode
  cache, discovered stores, markets). Cheap, unbounded, survives restarts.
- **Redis = hot layer**, doing two jobs: (1) optional small LRU cache in front of
  Postgres for genuinely hot lookups, (2) BullMQ's backing store.
- Read path: Redis → miss → Postgres → miss → external API → write back.

**Geocode data lives in Postgres, NOT primarily in Redis.** It's large, mostly
cold, and precious — the wrong shape for expensive evictable RAM. A Postgres
lookup on an indexed address is already fast; Redis is optional here.

### 3.3 Tiling for discovered-store reuse

Don't cache by the user's arbitrary drawn rectangle (two boxes are never
identical → no cache hits; "square inside a square" and partial overlaps break a
box-keyed cache). Instead:

- Overlay a **fixed grid of tiles** (e.g. geohash / H3 cell) on the map.
- Cache discovered stores **per tile per single category**.
- Decompose a market's boundary into the tiles it overlaps; fetch only the tiles
  (and categories) not already cached & fresh; reuse the rest.
- Assemble results from all overlapping tiles, **dedupe by OSM element id**, then
  **clip to the exact boundary** with `ST_Covers` / `ST_Contains`.

Nested/overlapping boxes now share tiles → maximum reuse.

### 3.4 Category fetch strategy (incremental, lazy)

- Cache **per single category**, never per category-combination (so {Pharmacy}
  reuses data fetched for {Supermarket, Pharmacy}).
- **Lazy / on-demand**: only ever fetch categories a market actually requests.
  Popular categories get fetched once and reused; the long tail is never fetched.
- On a discovery request: for each overlapping tile, reuse categories that are
  **cached AND fresh**; fetch only the **missing or stale** ones; write them with
  a fresh timestamp; return the combined set deduped by OSM id.
- **Do NOT ask the user to permanently commit to categories.** Lazy caching gives
  the same savings without that fragile UX.

Note on "broad fetch": Overpass's bbox model lets one call return many
categories at once. This trades API calls for a bit more compute/storage — a good
trade because API calls are the scarce, externally-limited resource and compute
is cheap and ours. The 30 sq km cap keeps the compute bounded.

### 3.5 Freshness (TTL) — lazy, not scheduled

- Discovered data has a freshness window (~5 days; Redis hot-cache keys can use a
  shorter 1-day TTL). "Cached" means "present AND fresh". Stale = treat as missing
  and re-fetch.
- Enforce freshness **at read time** (check `fetched_at`), and **upsert-overwrite**
  stale rows in place so actively-used tiles never accumulate garbage.
- **Cleanup**: only discovered data is cleaned up (geocode data is immutable →
  never). Use a **BullMQ repeatable job** for periodic cleanup of abandoned stale
  tiles (reuses existing infra; no OS cron / pg_cron needed). Cleanup is
  housekeeping only — read-time filtering already guarantees correctness.

### 3.6 Async processing (queue)

- Market creation is slow (geocoding + discovery + persistence). Do NOT block the
  user. On submit: create the market row, **enqueue** a discovery job, return
  **200 + job/market id immediately**.
- A **BullMQ worker** processes discovery in the background with **retries +
  rate-limiting** (respect Nominatim/Overpass fair use) and **partial-failure**
  handling.
- Frontend **polls a status endpoint** (~every 10s) with the id until status is
  `completed` or `failed`. On `completed`, fetch persisted results.
- **Queue solves responsiveness/retries/pacing. It does NOT reduce API call
  count** — that's what broad-fetch + tile cache do. They're partners, not
  substitutes.
- Queue the **slow, side-effecting** jobs only. Serve fast reads (dashboard, list,
  layer toggles) directly from Postgres — never through the queue.

### 3.7 Redis eviction — protect the queue

If cache and queue share one Redis: use **`volatile-lru`** and set a **TTL only on
cache keys**. Queue (BullMQ) keys have no TTL, so they're never evicted.
**Never use `allkeys-lru`** with a shared Redis — it can silently evict a job key
and lose jobs. Cleaner production alternative: two Redis instances (cache with
`allkeys-lru`, queue with `noeviction`). For the take-home: single Redis +
`volatile-lru`, document the two-instance split as the scaling story.

### 3.8 Spatial type policy (IMPORTANT — avoids a silent bug)

- **POINT locations → `geography(POINT, 4326)`.** Geography measures in **meters**
  on the WGS84 spheroid. This is required for the 150m matching bonus and any
  distance query. Using `geometry` for points is a classic silent bug: distances
  come back in **degrees**, so "within 150m" matches things kilometres away with
  no error.
- **Market boundary → `geometry(POLYGON, 4326)`.** Its only op is containment
  within a small metro area, where planar math is correct and the geometry
  function library + GiST indexing are simplest/fastest.

---

## 4. Database schema

PostGIS required. Migrations are split into six ordered files (see §5).

### Reference / seed tables

**country** (`id` PK, `name`, `iso_code` UNIQUE, `created_at`)
**state** (`id` PK, `country_id` FK→country, `name`, `code`, UNIQUE(country_id,
code), `created_at`) — *state codes are unique only within a country, so
reference parents by `id`, not by code.*
**city** (`id` PK, `state_id` FK→state, `name`, `min_lat/min_lng/max_lat/max_lng`
(nullable bbox for the initial map rectangle, geocoded lazily), UNIQUE(state_id,
name), `created_at`)

**category** (`id` PK, `label` UNIQUE, `value TEXT[]` NOT NULL with non-empty
CHECK, `created_at`)
- `label` = UI text; `value` = OSM tag expressions. One label → several tags
  (e.g. Pharmacy → `{amenity=pharmacy, shop=chemist}`), hence an array.

### Core domain tables

**market** (`id` PK, `city_id` FK→city ON DELETE RESTRICT, `boundary
geometry(POLYGON,4326)` NOT NULL, `status` CHECK in (queued/processing/completed/
failed) default queued, `error`, `created_at`, `updated_at`)
- GiST index on `boundary`; index on `city_id`.
- `updated_at` maintained by a `set_updated_at` trigger.
- `ST_IsValid(boundary)` CHECK rejects degenerate polygons.

**market_category** (`market_id` FK→market ON DELETE CASCADE, `category_id`
FK→category ON DELETE RESTRICT, PK(market_id, category_id)) — many-to-many, keeps
referential integrity (chosen over an array column).

**portfolio_store** (`id` PK, `store_name` NOT NULL, `address`, `city`, `state`,
`country`, `category`, `location geography(POINT,4326)` (null until geocoded),
`created_at`) — GiST index on `location`.

**portfolio_store_market** (`market_id` FK→market, `portfolio_store_id`
FK→portfolio_store, `is_inside BOOLEAN` NOT NULL, PK(market_id,
portfolio_store_id)) — inside/outside is **relative to a specific market's
boundary**, so it's a junction table, not a column on portfolio_store (a store
can be inside one market and outside another). Computed via
`ST_Contains(boundary, location)`.

### Caching tables

**geocode_cache** (`id` PK, `normalized_address` UNIQUE, `location
geography(POINT,4326)` NOT NULL, `created_at`) — immutable, kept forever;
satisfies Nominatim fair-use (cache results).

**tile_fetch** (`id` PK, `tile_key`, `category_id` FK→category, `fetched_at`
(drives freshness), UNIQUE(tile_key, category_id)) — one row per tile+category
fetch; index on `fetched_at`.

**discovered_store** (`id` PK, `tile_fetch_id` FK→tile_fetch ON DELETE CASCADE,
`osm_element_id` (stable dedupe key, e.g. `node/12345`), `name`, `category_value`,
`location geography(POINT,4326)` NOT NULL, `created_at`, UNIQUE(tile_fetch_id,
osm_element_id)) — GiST index on `location`; index on `tile_fetch_id`.
- **Tied to `tile_fetch`, NOT directly to a market**, so discovered stores are
  reusable across overlapping markets. A market's discovered set is assembled from
  the tiles its boundary overlaps.

---

## 5. Migrations (current state)

Split into six ordered, reversible files. Each has an `.up.sql` and `.down.sql`.
Ordering ensures each migration only references things created earlier; apply
001→006, roll back 006→001.

1. `001_extensions_and_helpers` — PostGIS extension + shared `set_updated_at()`
   trigger function.
2. `002_location_reference` — country, state, city.
3. `003_category` — category.
4. `004_market` — market, market_category, boundary GiST index, updated_at
   trigger.
5. `005_portfolio` — portfolio_store, portfolio_store_market.
6. `006_caching` — geocode_cache, tile_fetch, discovered_store.

**Database creation is a separate bootstrap step** (a migration runs *inside* a
DB and can't create the one it runs in). Create `market_scope` via Docker
(`POSTGRES_DB=market_scope`) or `createdb market_scope`, then run migrations.

### ⚠️ Not yet done / open decisions

- **Migration runner not chosen.** Files are raw SQL. Recommended:
  **node-pg-migrate** (takes raw SQL naturally, real tracked up/down, wires into
  `package.json` as `migrate:up` / `migrate:down`). Alternatives: Knex, Prisma,
  TypeORM. A minimal `psql`-based `migrate.sh up|down` exists as a fallback but
  has **no version tracking** (replays all files) — replace with a real runner.
- **NOT execution-verified.** These were written and structurally checked but
  never run against real PostGIS. **Run against the real DB early** and confirm:
  `geography`/`geometry` columns, GiST indexes, and the `ST_IsValid` CHECK
  constraint behave on your PostGIS version; the `updated_at` trigger fires on
  UPDATE.
- **`market.status` vs BullMQ source-of-truth.** Decision: BullMQ owns transient
  execution state in Redis; `market.status` is the durable, queryable projection
  the status API reads (survives queue restarts, keeps the status endpoint off
  Redis). Owned deliberately — not accidental duplication.

---

## 6. Build plan / remaining work

### Backend

- [ ] Pick migration runner; convert the six SQL migrations; wire `package.json`
      scripts. Run against real PostGIS and fix any issues.
- [ ] **Seed data**: India country → states → cities (committed static file, no
      external API at seed time, so it runs offline); category rows with real OSM
      tags (verify tags against the OSM wiki). Keep seed simple — the elaborate
      "seed all cities via API" idea is a README future-note, not build work.
- [ ] **Step 1 — upload**: CSV (decide if XLSX too; state it). Validation order:
      file type → file size → column headers → row-wise data. Decide row-failure
      policy (reject whole file vs accept-valid-and-report). Clear errors.
- [ ] **Step 2 — market setup APIs**: cascading dropdown endpoints
      (states-by-country, cities-by-state); categories endpoint; city→bbox
      (geocode + cache on city row).
- [ ] **Step 3 — create market**: endpoint that creates the market row, enqueues
      the discovery job, returns 200 + id. Worker: geocode missing portfolio
      coords (geocode-then-`ST_Contains` to decide within-boundary), tile-based
      discovery with incremental fetch + dedupe + clip, classify portfolio
      inside/outside, persist. Retries, rate-limiting, partial-failure handling.
- [ ] **Status endpoint** for polling (returns queued/processing/completed/failed
      + coarse progress; `failed` is first-class).
- [ ] **Dashboard read endpoints**: market detail, discovered stores, portfolio
      inside/outside, list view. Served directly from Postgres (not queued).
- [ ] **BullMQ repeatable cleanup job** for stale discovered data (optional /
      README-noted).

### Frontend (Vite + React)

- [ ] On load: fetch categories + countries in parallel.
- [ ] Upload input + validation error display.
- [ ] Cascading Country → State → City dropdowns.
- [ ] Map: on city select, fetch city bbox and render it as the **initial
      draggable/resizable rectangle** (not just center the map).
- [ ] **Live, throttled area check** on every drag/resize using `turf.area`
      (GeoJSON polygon → sq km; NOT width×height in degrees). Button **disabled by
      default**; enabled only while area ≤ 30 sq km; show live area (red when over
      cap + hint). Note: a city's initial bbox will usually exceed 30 sq km, so
      the user must shrink it first — communicate this clearly.
- [ ] Create → poll status every 10s → on completed, load dashboard; handle
      `failed` explicitly (no infinite spin).
- [ ] Dashboard: **three independent toggle/checkbox layers** (discovered /
      portfolio-inside / portfolio-outside), all default-on, freely combinable,
      distinct pin styles + list view (name + category). **Use checkboxes, not a
      dropdown** — the layers are independent/stackable, not exclusive modes.

### Tests (named targets the brief calls out)

- [ ] Boundary filtering (store inside / outside / exactly on the line).
- [ ] Header validation (missing column, wrong type, empty file).
- [ ] Geo logic (area calculation; containment; 150m match if bonus done).
- [ ] Backend unit + integration; React component tests. Single documented
      command to run.

### README (required deliverable)

- [ ] Setup/run instructions (`docker compose up && npm run migrate:up && npm run
      seed`, ideally).
- [ ] Architecture decisions (this document is the source).
- [ ] Known limitations / shortcuts (OSM coverage; not-verified items; scoped-out
      bonus).
- [ ] **Production-readiness section** (see §7) — shows judgment about what's
      deliberately out of scope.

---

## 7. Production-readiness notes (README "what I'd add next")

Deliberately scoped OUT of the take-home to protect a clean core; name them to
show judgment:

- **Observability** — structured logging (API calls, cache hit/miss, job
  failures), metrics (cache hit rate, API calls/min, queue depth, failure rate),
  alerting (queue backlog, discovery API failing). Biggest gap in any take-home.
- **Idempotency** — make jobs safe to run twice (upserts on stable ids + a job
  dedupe key), so a retried-after-timeout job doesn't double-insert.
- **Failure handling** — dead-letter queue for permanently failed jobs; clear UX
  for a half-built market.
- **Config & secrets** — env-based config for API keys, TTLs, tile size, the 30
  sq km cap (not hardcoded).
- **DB hardening** — spatial GiST indexes (done in schema), `fetched_at` index
  (done), connection pooling, versioned migrations (splitting done; add real
  runner).
- **Input hardening** — bounded / streamed CSV for large files; graceful
  rejection of malformed rows.
- **Scaling story** — Redis hot cache + LRU tier; two-Redis split (cache
  `allkeys-lru`, queue `noeviction`); tile+TTL cross-market cache; websockets/SSE
  instead of polling; dynamic reference-data seeding via API (e.g. GeoNames).

---

## 8. Quick glossary (plain English)

- **Cache** — save an answer so you don't fetch it again.
- **API call** — a request to an outside service; often costs money / rate-limited.
- **Geocoding** — turning an address into lat/long coordinates.
- **Rate limit** — max requests an external service allows per time window.
- **TTL** — expiry on cached data ("good for N days, then re-fetch").
- **Tile** — one cell of a fixed grid laid over the map; the unit of the
  discovered-store cache.
- **Portfolio stores** — the customer's own uploaded stores.
- **Discovered stores** — other stores found via the places API.
- **Persist** — save durably in the database.
- **PostGIS** — Postgres extension for spatial data (points, polygons, distance,
  containment).
- **Bounding box** — the rectangle on the map marking the search area.
- **`ST_Contains` / `ST_Covers`** — is this point inside this polygon?
- **`ST_DWithin`** — are these within X meters of each other? (needs geography for
  meters.)
