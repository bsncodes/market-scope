# ADR-0005 — Geocodes never expire, tiles go stale in five days

**Status:** accepted
**Affects:** `api/migrations/006_caching.sql`, `api/src/repositories/discovery.ts`, `api/src/controllers/geocode.ts`

## Context

Two things get cached: the coordinates of an address, and the stores inside a
tile. The instinct is to give both a TTL and move on.

They are not the same kind of fact.

## Decision

`geocode_cache` has no expiry. `tile_fetch` carries a `fetched_at` and is
treated as stale after five days.

## Why

"12 MG Road, Bengaluru is at 12.97, 77.59" does not stop being true. Buildings
do not move. Re-geocoding an address we have already resolved spends a
Nominatim request — at one per second, the scarcest budget in the system — to
learn something we already knew.

"There is a Reliance Fresh in this square kilometre" does stop being true.
Shops close, open and change hands. Five days is a judgement call: long enough
that a demo session and a follow-up the next day both hit cache, short enough
that a market created a week later reflects something current.

City bounding boxes sit on the permanent side too, stored on the `city` row
itself rather than in a cache table, because they are reference data with the
same lifetime as the city.

## Why staleness is checked on read

There is no background job sweeping stale tiles. `findFreshTileKeys` filters
on `fetched_at > now() - interval` at the moment a tile is looked up, so a
stale row is treated exactly like a missing one and re-fetched.

This keeps correctness in a single place. With a sweeper there is always a
window where the job has not run yet and a reader has to decide whether to
trust what it found — which means the read path needs the freshness check
anyway, and now there are two mechanisms that must agree.

It also avoids the cascade problem: deleting a stale `tile_fetch` row would
take its `discovered_store` children with it and empty any existing market
that overlapped that tile. See [ADR-0003](0003-tile-based-caching.md).

## What it costs

Stale rows accumulate. Nothing reclaims the space. For a take-home that is
irrelevant; for a long-running deployment it needs the `market_tile` join
table described in ADR-0003 before anything can safely be deleted.

The geocode cache is global rather than per-tenant. There is no tenancy in
this system, so it is a benefit today — two users uploading overlapping
portfolios share the work. Under real multi-tenancy it would need thought, if
only because "which addresses has anyone ever looked up" is itself
information.
