# Cycle 5 — Tests, README, hardening pass

**Goal:** deliverable-ready. This cycle is what actually gets evaluated —
don't let it be the thing that gets cut when time runs short (§1: "the bar
is on code you can explain and defend, not just code that compiles").

**Depends on:** Cycles 1–4 all functioning.
**Blocks:** nothing — this is the last cycle. Bonus work only starts after
this is solid.

---

## 5.1 Tests (named targets from the brief — these are not optional extras)

- **Boundary filtering**: a store exactly inside, exactly outside, and
  **exactly on the boundary line** — the edge case is deliberately named,
  make sure `ST_Contains` vs `ST_Covers` semantics are tested for it, not
  just assumed.
- **Header validation**: missing required column, wrong column order,
  wrong data type in a cell, completely empty file — one test per case,
  asserting the specific error message/policy chosen in Cycle 2.
- **Geo logic**: area calculation (a known polygon → known sq km via
  `turf.area`, confirm it's not the width×height-in-degrees bug), boundary
  containment, and the 150m match distance calculation if the bonus was
  built.
- **Backend**: unit tests for validation/geo logic, integration tests for
  at least the create-market → discovery → dashboard-read path (can mock
  the external Overpass/Nominatim calls here — that's appropriate for
  integration tests, unlike Cycle 3's real-API exit criteria).
- **Frontend**: React component tests for the upload error display and
  the area-cap-disables-button behavior at minimum.
- **One documented command** to run everything (e.g. `npm test` at root,
  or clearly documented per-package commands) — a reviewer should not have
  to hunt for how to run tests.

## 5.2 README (required deliverable)

- **Setup/run instructions**: ideally a single sequence like
  `docker compose up && npm run migrate:up && npm run seed && npm run dev`.
  Test this from a genuinely clean clone, not just your own machine's
  cached state.
- **Architecture decisions**: `../MARKETSCOPE_KNOWLEDGE.md` is the source
  — pull the *why* behind: OSM/Overpass over Google Places, geocode vs
  discovered data lifetimes, tile-based caching, lazy per-category fetch,
  queue design, Redis eviction policy, geography vs geometry column choice.
  Don't just copy the doc verbatim — summarize each decision in the
  reviewer's terms and link back to code.
- **Known limitations / shortcuts**: OSM coverage/tagging quality varies;
  anything from Cycle 1's verification list that turned out to need a
  workaround; whatever bonus work was scoped out and why.
- **Production-readiness section** (§7) — explicitly name what's out of
  scope, this is itself a signal of judgment, not an admission of
  incompleteness:
  - Observability (structured logging, cache hit-rate/API-call/queue-depth
    metrics, alerting).
  - Idempotency (upserts on stable ids + job dedupe keys so a retried job
    can't double-insert).
  - Failure handling (dead-letter queue, UX for a half-built market).
  - Config & secrets (env-based, already partly done in Cycle 1 — note
    what's left).
  - DB hardening (connection pooling; migrations already versioned).
  - Input hardening (bounded/streamed CSV parsing for large files).
  - Scaling story (two-Redis split, cross-market tile+TTL cache at scale,
    websockets/SSE instead of polling, dynamic reference-data seeding via
    a geodata API).

## 5.3 Bonus — store matching (only if 5.1 and 5.2 are done and solid)

- For each portfolio store, check via `ST_DWithin` (needs `geography` for
  meter-based distance, per §3.8) whether a discovered store exists within
  **150 meters**.
- Mark matched stores; add a 4th independently-toggleable map layer for
  them.
- **Do not start this before the core is clean** — an unfinished bonus
  layer next to a solid core reads worse than no bonus at all (§1 is
  explicit on this).

---

## Exit criteria

- [ ] Fresh clone, no local state carried over: documented setup command
      brings the full stack up from nothing.
- [ ] Single documented test command passes across backend + frontend.
- [ ] README covers setup, every major architecture decision with its
      rationale, known limitations, and the production-readiness section
      — a reviewer should be able to evaluate the project without asking
      a single clarifying question.
- [ ] If bonus was attempted: it does not regress or complicate the core
      three-layer dashboard; it's additive only.
