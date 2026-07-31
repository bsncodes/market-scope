# Cycle 2 — Ingest & market-setup APIs (steps 1 & 2, backend only)

**Goal:** upload and market-setup endpoints work in isolation, backed by
real Postgres reads/writes. No queue, no discovery, no frontend yet — this
cycle is API-only and testable with curl/Postman.

**Depends on:** Cycle 1 (migrated + seeded DB).
**Blocks:** Cycle 4 (frontend needs these endpoints to exist).

---

## 2.1 Portfolio upload (functional step 1)

- Endpoint accepts CSV only.
- Validation pipeline, in this exact order (fail fast, cheapest checks
  first):
  1. **File type** — reject non-CSV/XLSX immediately.
  2. **File size** — reject oversized uploads before parsing.
  3. **Column headers** — expect exactly `store_name, address, city, state,
     country, category, latitude (optional), longitude (optional)`;
     reject on missing/renamed required columns with a specific message
     naming the missing column.
  4. **Row-wise data** — required fields present, `latitude`/`longitude` if
     given are valid numbers in range.
- Decide the **row-failure policy** explicitly — this is a named
  evaluation point, not a detail to skip:
  - Reject-whole-file: any bad row fails the entire upload, returned to the user with the row number + reason.
- **An upload replaces the entire portfolio** — `DELETE FROM portfolio_store`
  then insert, in one transaction. Decided over an `upload_batch` table or
  natural-key dedupe: the brief treats the portfolio as one thing the user
  brings (no accounts, no multi-tenancy, no merge story anywhere in the four
  step flow), so a batch table adds a join to every downstream query and a
  "which batch?" question the product never asks. `(store_name, address)`
  dedupe was rejected too — it silently collapses two real stores sharing a
  mall address and still answers nothing about replacement.
  - Migration `007` added `ON DELETE CASCADE` to both `portfolio_store_market`
    FKs, which is what makes this delete possible at all.
  - Consequence to document in the README: re-uploading resets the portfolio,
    so markets created earlier lose their portfolio layers and show discovered
    stores only. Acceptable for a linear single-session flow; multi-portfolio
    versioning is the named future extension.
- Persist accepted rows to `portfolio_store`. `location` stays NULL for
  rows missing lat/long — those get geocoded later, in Cycle 3, but only
  if they fall inside a market's boundary (geocoding everything eagerly
  wastes Nominatim calls on stores that will never be queried).

## 2.2 Market-setup APIs (functional step 2)

- `GET /countries` — from seeded `country` table.
- `GET /states?country_id=` — cascading, from `state`.
- `GET /cities?state_id=` — cascading, from `city`.
- `GET /categories` — from seeded `category` table, returns `id` + `label`
  (never expose raw OSM `value` tags to the frontend — that's an internal
  discovery detail).
- `GET /cities/:id/bbox` — returns the city's bounding box for the initial
  map rectangle:
  - If `city.min_lat/min_lng/max_lat/max_lng` are already populated,
    return them directly (cache hit, no external call).
  - If NULL, geocode the city via Nominatim, derive a bbox, **write it
    back onto the `city` row** (lazy population per §4), then return it.
  - This is a good place to prove the geocode-cache pattern early: a
    second call for the same city must not hit Nominatim again.

---

## Exit criteria

- [x] Uploading a CSV with one deliberately malformed row (bad header, bad
      lat/long, missing required field) produces a clear, specific error —
      not a generic 500 or silent drop — consistent with the chosen
      row-failure policy.
- [x] Uploading a fully valid CSV persists all rows to `portfolio_store`
      with `location` NULL where lat/long weren't provided.
- [x] `GET /states?country_id=` and `GET /cities?state_id=` return only
      children of the given parent — no leakage across countries/states.
- [x] `GET /cities/:id/bbox` called twice for the same never-geocoded city:
      the first call populates `city.min_lat` etc.; the second call
      returns the same values without a second Nominatim request
      (confirm via logs or a temporary call counter).
