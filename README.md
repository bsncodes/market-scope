# MarketScope

See where your stores sit relative to the wider retail universe in a city:
upload your portfolio, draw a market boundary on a map, discover other stores
inside it, and visualise everything on a dashboard.

An npm workspaces monorepo — one install at the root covers both packages.

- `api/` — Node.js + TypeScript service (Postgres/PostGIS, Redis, BullMQ).
  Runs as two processes: the HTTP API (`npm run dev`) and the discovery worker
  (`npm run worker`). Market creation enqueues a job the worker consumes, so
  both must be running for discovery to complete.
- `app/` — Vite + React + TypeScript frontend

## Setup

Requires Docker and Node.js 22+.

```bash
cp .env.example .env               # DATABASE_URL, Redis, API base URLs, tuning knobs
docker compose up -d               # Postgres + PostGIS, Redis
npm install                        # installs root + api + app
npm run init:setup --workspace api # migrate:up + seed (India reference data, categories)
```

`init:setup` deliberately does not start Docker — container lifecycle is a
separate concern from schema/data setup, so the two stay independently
re-runnable. Both steps are idempotent and safe to re-run.

Running Postgres locally instead of via Docker? Create the database first
(`createdb market_scope`), since a migration runs _inside_ a database and can't
create the one it runs in.

## Development

Run from the repo root:

```bash
npm run ci                            # what CI runs: format:check + lint + typecheck + build
npm test                              # unit + integration (needs docker compose up)
npm run format                        # apply Prettier formatting
npm run lint                          # oxlint across both workspaces

npm run worker       --workspace api  # discovery worker (required for market creation)
npm run migrate:up   --workspace api  # apply migrations
npm run migrate:down --workspace api  # roll back one migration
npm run seed         --workspace api  # re-seed reference data
npm run dev          --workspace app  # frontend dev server
```

CI runs `npm run ci` on every push to `main` and every PR targeting it, so the
command above is exactly what gates a merge. CodeQL security scanning runs on
the same triggers plus a weekly schedule.

> Architecture decisions, known limitations, and production-readiness notes are
> written up in Cycle 5 — see `cycles/05-tests-readme-hardening.md`.
