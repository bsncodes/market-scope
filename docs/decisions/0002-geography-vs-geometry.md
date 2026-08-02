# ADR-0002 — `geography` for points, `geometry` for boundaries

**Status:** accepted
**Affects:** `api/migrations/004_market.sql`, `005_portfolio.sql`, `006_caching.sql`

## Context

PostGIS offers two spatial types. `geometry` treats coordinates as points on a
flat plane — fast, and wrong at scale unless you project first. `geography`
treats them as points on a spheroid — correct in metres, and slower.

Picking one for everything would have been simpler. We use both.

## Decision

Every point column — `portfolio_store.location`, `discovered_store.location`,
`geocode_cache.location` — is `geography(POINT, 4326)`.

Every boundary — `market.boundary` — is `geometry(POLYGON, 4326)`.

## Why

Points are things we measure distances between. `geography` gives metres
without projecting, so `ST_DWithin(a, b, 150)` means 150 metres rather than
150 degrees of something. If the store-matching bonus gets built, that is the
function it needs, and getting the units right for free is worth the cost.

Boundaries are things we test containment against. `ST_Contains` is a
`geometry` function, and it is fast — a GiST index on a geometry column
serves it directly.

Area is the case that decides the mix. `ST_Area` on a geometry column returns
square degrees, which is not a unit of anything anybody wants. Casting to
geography at the call site gives square metres on the spheroid:

```sql
SELECT ST_Area(boundary::geography) / 1000000 AS area_sq_km
```

So the boundary is stored as the type that makes containment fast and cast to
the type that makes area meaningful, once, in the two places that measure it.

## What it costs

Mixed types mean casts, and casts have consequences. The dashboard's store
query reads:

```sql
WHERE ST_Contains(m.boundary, ds.location::geometry)
```

That cast takes `location` out of geography space, which means the GiST index
on `discovered_store.location` cannot serve the predicate. At a hundred-odd
stores per market it does not matter. At scale it wants a functional index on
`(location::geometry)`, which is deliberately not added — an unmeasured index
on a table this size is a guess.

`ST_MakePoint` takes `(x, y)`, meaning longitude before latitude. Reversing
them is silent: the row inserts happily, into the wrong hemisphere. There is a
test asserting that longitude is stored as X, which exists because this is
exactly the kind of mistake that survives review.
