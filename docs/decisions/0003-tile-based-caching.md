# ADR-0003 — Tile-based caching, keyed to the world

**Status:** accepted
**Affects:** `api/src/helpers/tiling.ts`, `api/src/repositories/discovery.ts`, `api/migrations/006_caching.sql`

## Context

Discovery has to ask Overpass what is inside a boundary. The naive version
sends the boundary itself as one bbox query and stores the result against the
market.

That works, and it means every market pays full price. Two markets covering
neighbouring parts of the same city share nothing, even where they overlap
almost exactly. Against a service that grants two slots per IP and bills by
CPU time, paying twice for the same square kilometre is the thing to avoid.

## Decision

Split every boundary onto a **fixed grid aligned to the world**, not to the
market. Cache each tile-and-category pair. `discovered_store` hangs off
`tile_fetch`, never off `market`.

```
step  = tileSizeKm / 110.574          // degrees
key   = "{floor(lat/step)}:{floor(lng/step)}"
```

## Why

Because the grid is fixed, two overlapping markets produce overlapping tile
keys, and the second one finds them already cached. That is the entire
benefit, and it only works if the grid does not move with the market.

`Math.floor`, not truncation. Truncating collapses -0.5 and +0.5 onto the same
cell, which silently merges the northern and southern hemispheres. There is a
test for it.

Tiles are fetched per category rather than all at once. A market for
supermarkets should not pay to fetch pharmacies, and a later market that does
want pharmacies over the same ground finds the supermarket tiles already there
and fetches only what it is missing.

`MAX_TILES_PER_MARKET = 2000` is a guard against misconfiguration, not against
users. The 30 sq km cap already bounds legitimate markets to a few dozen
tiles; two thousand means somebody set the tile size to metres.

## What it costs

**The grid over-covers.** The step is derived from latitude only, so tiles are
narrower than nominal in the east–west direction anywhere off the equator, and
the tiles at a boundary's edge extend past it. That is intentional — the cache
holds stores outside the rectangle the user drew, and `ST_Contains` clips them
at read time. Over-covering costs a few extra requests; under-covering loses
stores silently.

**Nothing links a market to its tiles.** The relationship is computed by a
spatial query whenever the dashboard is read. This is the real price of the
design, and it has a consequence worth stating plainly: a cleanup job that
deleted stale `tile_fetch` rows would cascade into `discovered_store` and
silently empty the dashboard of any existing market that overlapped them.

That is why there is no cleanup job. Not time — correctness. Building one
needs a `market_tile` join table so a tile can be retained while any market
still depends on it, and that is a schema change with its own migration and
its own reasoning. It belongs in the next cycle, not smuggled into this one.
