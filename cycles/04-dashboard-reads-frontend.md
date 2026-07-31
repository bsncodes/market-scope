# Cycle 4 — Dashboard reads & frontend

**Goal:** the full user-facing flow works end to end in a browser: upload,
draw a boundary, create a market, watch it complete, see the dashboard.

**Depends on:** Cycle 2 (upload + setup APIs), Cycle 3 (discovery produces
real data to read).
**Blocks:** Cycle 5 (can't write meaningful tests/README screenshots
against a flow that doesn't work yet).

---

## 4.1 Dashboard read endpoints (backend)

Served directly from Postgres — **never through the queue** (§3.6: queue
the slow side-effecting jobs only, fast reads stay direct):

- `GET /markets/:id` — market detail (status, boundary, city, categories).
- `GET /markets/:id/discovered-stores` — assembled from the tiles the
  market's boundary overlaps, already clipped/deduped from Cycle 3.
- `GET /markets/:id/portfolio` — split by `is_inside` from
  `portfolio_store_market`, or return both with the flag and let the
  frontend split.
- List view needs at minimum `name` + `category` per the brief — make
  sure these endpoints return enough to render that without extra calls.

## 4.2 Frontend shell

- On app load: fetch `/categories` and `/countries` **in parallel** (no
  reason to serialize these).
- Upload screen: file input, call the Cycle 2 upload endpoint, render
  validation errors clearly (per-row if that's the chosen policy) —
  don't let a bad file silently fail.
- Market setup screen: cascading Country → State → City dropdowns
  (seeded, not free text — §1), category multi-select.

## 4.3 Map + boundary drawing

- On city selection, call `/cities/:id/bbox` and render that rectangle as
  the **initial** draggable/resizable boundary — don't just center the
  map on the city, actually seed the rectangle from real data.
- **Live, throttled area check** on every drag/resize:
  - Use `turf.area` on the actual GeoJSON polygon — **not** a
    width×height-in-degrees approximation, which is wrong because degree
    width varies with latitude.
  - Throttle so this doesn't recompute on every pixel of drag.
  - Show the live area value; flip it red and show a hint when over
    30 sq km.
  - "Create Market" button is **disabled by default**, only enabled while
    area ≤ 30 sq km.
  - Note in the UI copy: a city's initial bbox will usually exceed
    30 sq km, so the user needs to shrink it first — make this obvious,
    don't make them guess why the button is disabled.

## 4.4 Create → poll → dashboard

- On "Create Market": call `POST /markets`, get back `market_id`
  immediately, navigate to a waiting/status view.
- Poll `GET /markets/:id/status` every ~10s.
- On `completed`: load the dashboard (4.1's endpoints).
- On `failed`: show this explicitly — a clear failed state, not an
  infinite spinner.

## 4.5 Dashboard layers

- Three independent **checkboxes** (not a dropdown/radio — the brief is
  explicit that these are stackable, freely-combinable layers, not
  exclusive view modes):
  1. Discovered stores
  2. Portfolio inside boundary
  3. Portfolio outside boundary
- All default **on**. Each gets a visually distinct pin style so overlaid
  layers stay legible.
- List view alongside the map: name + category minimum, ideally filtered
  to match whichever layers are currently toggled on.

## 4.6 Data freshness — label it, don't refresh it

- Show the discovered layer with a **"Discovered `<date>`"** label, read from
  `market.last_discovered_at` (added in migration `007`). One column read —
  deriving it from `min(fetched_at)` across overlapping tiles would mean
  decomposing the boundary on a read path §3.6 requires to stay fast.
- **No refresh / re-discover button.** Deliberately cut: it isn't in the
  brief's four-step flow, and the only case where it genuinely helps —
  retrying tiles that permanently failed — belongs in Cycle 3's job error
  handling, not a dashboard control. Adding it would mean a cooldown state
  machine (refresh inside the freshness window is a pure no-op: the worker
  finds every tile fresh, calls Overpass zero times, returns identical data)
  for a scenario that barely exists in a single-session demo.
- Partial failures surface through `market.error` as "some areas couldn't be
  fetched" — no new mechanism.
- **Related known limitation for the README**: because `discovered_store`
  hangs off `tile_fetch` and nothing links a market to its tiles, a cleanup
  job that deleted stale tiles would silently empty an existing market's
  dashboard. That's the reason cleanup stays unbuilt (see Cycle 3) — not
  lack of time.

---

## Exit criteria

- [ ] Full click-through in an actual browser: upload a CSV → select
      country/state/city/categories → boundary auto-fills from city bbox
      → drag/resize it (watch the area readout update and the Create
      button enable/disable correctly at the 30 sq km line) → create →
      watch it poll → land on a populated dashboard.
- [ ] All three layer checkboxes toggle independently and can be combined
      in any combination, including all-off.
- [ ] A deliberately triggered `failed` market (e.g. from Cycle 3's forced
      failure test) renders a clear failed state in the UI, not a stuck
      spinner.
- [ ] List view entries match what's shown on the map for the currently
      toggled layers.
