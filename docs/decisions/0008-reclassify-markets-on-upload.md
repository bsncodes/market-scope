# ADR-0008 — Re-uploading a portfolio reclassifies every market

**Status:** accepted
**Affects:** `api/src/controllers/portfolio.ts`, `api/src/repositories/discovery.ts`

## Context

`portfolio_store_market` is derived data: which of your stores fall inside
which market's boundary. Migration 007 gave it `ON DELETE CASCADE` on both
foreign keys, on the reasoning that when either parent goes the row is
meaningless. That reasoning is sound.

Uploading a portfolio replaces it wholesale — `DELETE FROM portfolio_store`,
then insert. Which cascades.

## The bug

Every market created before an upload silently lost its inside and outside
layers. Not an error, not a warning. The market row survived, its discovered
stores survived, the dashboard opened normally — and the two portfolio layers
were simply empty, which reads as "the map stopped plotting my stores" rather
than as data loss.

Reproduced directly in SQL: two classification rows before the upload, zero
after.

It surfaced the way this class of bug usually does — someone reopened an older
market and asked why the portfolio pins were missing.

## Decision

After a successful upload, reclassify every existing market against the new
portfolio, in one statement:

```sql
INSERT INTO portfolio_store_market (market_id, portfolio_store_id, is_inside)
SELECT m.id, ps.id, ST_Contains(m.boundary, ps.location::geometry)
FROM market m, portfolio_store ps
WHERE ps.location IS NOT NULL
ON CONFLICT (market_id, portfolio_store_id)
DO UPDATE SET is_inside = EXCLUDED.is_inside
```

The upload response now reports `reclassified_markets` so the effect is
visible rather than implied.

## Alternatives considered

**Snapshot the portfolio per market at discovery time.** Correct, and it makes
each market a true point-in-time record. It also duplicates every portfolio
row per market and needs a schema change. Right answer for a product with
history requirements; too much for this.

**Leave it, and warn in the UI.** Cheapest, and it makes old markets
permanently half-broken. Rejected — a dashboard that renders an empty layer
without saying why is worse than one that recomputes.

**Drop the cascade, keep orphaned rows.** Fails immediately: the classification
would point at portfolio store ids that no longer exist.

## What it costs

The work is `markets × located stores` rows on every upload. At 25 markets and
112 stores that is 2,800 upserts in one statement — milliseconds. It grows
linearly with both, so at thousands of markets this belongs on the queue
rather than in the request. Fine for now, and the sort of thing that should be
noticed before it is a problem rather than after.

One consequence worth being explicit about: a market's portfolio split now
reflects the _current_ portfolio, not the one that existed when the market was
created. For this product that is the more useful reading — you want to know
where your stores are today. It is a real semantic choice, not an accident.
