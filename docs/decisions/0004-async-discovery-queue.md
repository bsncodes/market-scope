# ADR-0004 — Discovery runs on a queue, in a separate process

**Status:** accepted
**Affects:** `api/src/queue.ts`, `api/src/worker.ts`, `api/src/controllers/discovery.ts`

## Context

Creating a market means fetching every tile it covers from Overpass, geocoding
whatever portfolio rows lack coordinates, and classifying everything. A market
at the 30 sq km cap covers 20 tiles, so three categories is 60 Overpass
requests paced at one every four seconds — four minutes — plus a Nominatim
call per unlocated store at roughly one per second.

Minutes, not milliseconds.

## Decision

`POST /api/markets` writes the row, enqueues a BullMQ job and returns `202`
with the market id. A separate worker process consumes the queue. The frontend
polls a status endpoint.

## Why

Doing it inline holds an HTTP connection open for minutes and then loses
everything to a proxy timeout somewhere in the middle. Worse, there would be
no record of how far it got.

Separating the processes means the API stays responsive under load — the
worker can be saturated with a large market while every dashboard read is
still one fast query. It also means the two scale independently, at least in
principle (see the caveat below).

`jobId = market-<id>` makes the enqueue idempotent. A double-submit produces
the same job id and BullMQ keeps one.

`attempts: 3` with exponential backoff covers the case where the whole run
falls over — a dropped database connection, a restart mid-job. Individual tile
failures do **not** reach BullMQ; they are isolated and retried in place,
because a single bad tile should not restart forty good ones.

Progress lives in a `jsonb` column on `market`, not in BullMQ's job state.
That way the status endpoint reads one row and never touches Redis, and the
numbers survive a queue restart or a flushed Redis.

## What it costs

**Two processes to run.** `npm run dev` and `npm run worker`, both. Forget the
worker and every market sits at `queued` forever. The status screen says so
rather than spinning, and the README says so twice, but it is still a sharper
edge than a single process would have.

**Terminal status is the worker's responsibility, not the controller's.**
`runDiscovery` deliberately does not catch and mark the market failed on its
way out. An earlier version did, and it made the retry configuration dead
code — the first attempt wrote the final state, so the two remaining attempts
had nothing left to change.

**The rate limiter is per process.** Running two workers means two token
buckets and twice the real request rate against Overpass, which breaches fair
use without anything in the code looking wrong. Horizontal scaling needs a
Redis-backed bucket so the budget is shared rather than duplicated. Called out
in the source at the point where it would bite.
