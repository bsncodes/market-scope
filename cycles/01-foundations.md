# Cycle 1 — Foundations (data layer online)

**Goal:** a real, verified database and repo skeleton to build everything
else against. Nothing in Cycle 2+ can start until migrations run cleanly
against real PostGIS.

**Depends on:** nothing.
**Blocks:** everything.

---

## 1.1 Monorepo skeleton

- `/app` — Vite + React app (empty scaffold is fine for now).
- `/api` — Node.js service.
- `docker-compose.yml` at repo root with two services:
  - `postgres` — PostGIS-enabled image (e.g. `postgis/postgis`), exposing
    `POSTGRES_DB=market_scope`, `POSTGRES_USER`, `POSTGRES_PASSWORD`.
  - `redis` — for the BullMQ backing store + optional hot cache.
- `.env.example` at repo root (or per-package) listing every env var the
  app reads: DB connection string, Redis URL, Nominatim/Overpass base
  URLs, tile size, freshness TTL days, 30 sq km cap — per §7 "Config &
  secrets," these should never be hardcoded even in the take-home.
- Root `README.md` gets a placeholder "Setup" section now; it's filled in
  for real in Cycle 5.

## 1.2 Migration runner

- Pick **node-pg-migrate** (recommended in §5 — takes raw SQL naturally,
  gives real tracked up/down, wires into `package.json`).
- Migration files live under `api/migrations/` — migrations are a
  backend concern (they define the schema the backend queries), the
  frontend never touches them, so root-level would be the wrong altitude
  for a single-service monorepo like this.
- Convert the six existing raw `.up.sql`/`.down.sql` file pairs into the
  runner's format, preserving their order:
  1. `001_extensions_and_helpers` — PostGIS extension, `set_updated_at()`
     trigger function.
  2. `002_location_reference` — country, state, city.
  3. `003_category` — category.
  4. `004_market` — market, market_category, boundary GiST index,
     `updated_at` trigger.
  5. `005_portfolio` — portfolio_store, portfolio_store_market.
  6. `006_caching` — geocode_cache, tile_fetch, discovered_store.
- Wire `npm run migrate:up` / `npm run migrate:down` in `api/package.json`.
- **Database creation is not a script — it's `docker-compose.yml`'s job.**
  A migration runs *inside* a database and can't create the one it runs
  in, so `market_scope` has to exist before `migrate:up` ever runs. The
  Postgres image auto-creates a database named by `POSTGRES_DB` on the
  container's first startup, so setting `POSTGRES_DB=market_scope` in the
  root `docker-compose.yml` (§1.1) is the entire mechanism — no
  `createdb` script needed, in the backend or anywhere else, when using
  Docker.
- Document one manual fallback in the README (Cycle 5) for anyone running
  a local Postgres instead of Docker: `createdb market_scope`. This stays
  a documented command, not a script — it's a one-time, environment-
  dependent bootstrap step (needs superuser/createdb privilege) outside
  the app's own runtime, so it doesn't belong in `init:setup` or any
  npm script.

## 1.3 Verify against real PostGIS (§5 "not yet execution-verified")

These were written and structurally checked but never run — treat this as
a real checklist, not a formality:

- [ ] `geography(POINT, 4326)` columns accept inserts and round-trip
      correctly (portfolio_store.location, geocode_cache.location,
      discovered_store.location).
- [ ] `geometry(POLYGON, 4326)` column accepts a boundary insert
      (market.boundary).
- [ ] GiST indexes actually get created (`\d+ table_name` in psql, or
      query `pg_indexes`) on `market.boundary`, `portfolio_store.location`,
      `discovered_store.location`.
- [ ] The `ST_IsValid(boundary)` CHECK constraint on `market` rejects a
      deliberately self-intersecting/degenerate polygon insert.
- [ ] The `set_updated_at` trigger on `market` actually fires and bumps
      `updated_at` on an `UPDATE`.
- [ ] `migrate:down` all the way to zero, then `migrate:up` again — confirm
      it's idempotent and reversible.

## 1.4 Seed data

- **Scope: India only, for now.** One `country` row (India). No other
  countries get seeded in this cycle — the schema supports more later, but
  don't spend seed-data effort outside India until there's a reason to.
- Within India, seed **all states and union territories** (`state` table)
  and, for each, a reasonably complete set of real **cities** (`city`
  table) — not just one or two sample cities per state. This is what
  makes the cascading Country → State → City dropdowns in Cycle 2 actually
  exercise real cascading behavior instead of a trivial one-item case.
- **Source: an npm package** with India state/city reference data (e.g.
  `country-state-city` or equivalent — confirm it's maintained and its
  India data is current before pinning it), not a hand-maintained CSV.
  Add it as an `api` dependency, and have the seed script import it
  and transform/filter to India only at seed-time.
- This is still **fully offline** and still **no external API call** —
  the data is resolved from the installed package at seed-time, not
  fetched over the network. That distinction (dependency vs live API
  call) is what keeps this consistent with the "no external API at seed
  time" rule; don't add a live geodata API call here. The elaborate "seed
  every country by calling a geodata API" idea is still explicitly a
  README future-note (§7), not build work now.
- Because the package's shape almost certainly won't match `state`/`city`
  schema 1:1 (e.g. different id scheme, extra fields, possibly different
  state-code conventions), the seed script needs an explicit mapping step
  — write it as a small transform function, not inline ad-hoc code, so
  it's easy to re-run if the package updates.
- **Runner shape**: a single seed script (e.g. `api/scripts/seed.ts`,
  wired as `npm run seed`) that calls one seed function per table, in
  dependency order — `seedCountry()` → `seedStates(countryId)` →
  `seedCities(stateIds)` → `seedCategories()`. Each function owns its own
  transform-and-insert logic for that table; the script is just the
  orchestrator that calls them in order. Keep each function idempotent
  (upsert on the table's unique constraint — `iso_code` for country,
  `(country_id, name)` for state, `(state_id, name)` for city) so
  `npm run seed` can be re-run safely without duplicating rows.
- City `min_lat/min_lng/max_lat/max_lng` bbox columns stay NULL at seed
  time (per §4, populated lazily on first bbox request in Cycle 2) —
  don't try to pre-populate bboxes for every seeded city, that's exactly
  the eager/lazy tradeoff §3.4 already made a call on.
- Category rows: `label` (UI text) + `value` (`TEXT[]` of OSM tag
  expressions, e.g. Pharmacy → `{amenity=pharmacy, shop=chemist}`).
  Verify every tag against the current OSM wiki before committing — a
  wrong tag here silently breaks discovery in Cycle 3 with no error, just
  empty results.

## 1.5 One-command setup: `npm run init:setup`

- `npm run init:setup` covers just the two DB-state steps, in order:
  1. `npm run migrate:up`.
  2. `npm run seed`.
- **Docker (`docker compose up`) is a separate, manual precondition** —
  Postgres/Redis need to already be up and reachable before running
  `init:setup`. Don't fold container startup into this script; it's
  infra lifecycle, not schema/data setup, and bundling them would mean
  a slow container-readiness poll is baked into a command someone might
  want to re-run quickly during dev iteration.
- `migrate:up` and `seed` still exist as their own standalone scripts too
  (useful on their own during development — e.g. re-seeding without
  touching migrations), `init:setup` just chains them for the common case.
- Because §1.4's seed functions are idempotent and migrations are
  tracked/reversible, `init:setup` is safe to re-run against existing
  state, not just a freshly-created database.

---

## Exit criteria

- [ ] With Postgres+Redis already up via `docker compose up`, a single
      `npm run init:setup` runs all migrations and seeds India
      country/state/city/category data with no manual intervention.
- [ ] Re-running `npm run init:setup` on top of already-set-up state
      succeeds without error or duplicated rows (idempotency check).
- [ ] `npm run migrate:down` (to zero) followed by `npm run migrate:up`
      again succeeds — proves reversibility, not just forward application.
- [ ] A manual `psql` query confirms seeded cities (with parent state/country)
      and categories (with correct OSM tag arrays) are present and correct.
- [ ] All six checks in §1.3 pass against the real running PostGIS instance.
