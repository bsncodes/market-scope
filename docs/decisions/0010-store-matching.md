# ADR-0010 — Matching portfolio stores against discovered ones

**Status:** accepted
**Affects:** `api/src/repositories/dashboard.ts`, `app/src/pages/DashboardPage.tsx`

## Context

The dashboard shows what OSM knows about an area and where your stores sit
relative to a boundary, but never connects the two. A user looking at 112
discovered stores and 9 of their own has no way to tell whether any of those
are the same shop.

That question has a practical edge. A portfolio store with no OSM store near
it is either genuinely unmapped, or its address geocoded to the wrong place —
and the second case quietly undermines the inside/outside counts.

## Decision

For each portfolio store, find the nearest discovered store within
`STORE_MATCH_RADIUS_M` (default 150) that belongs to a category this market
selected. Report it as a fourth toggleable layer.

```sql
LEFT JOIN LATERAL (
  SELECT ds.osm_element_id,
         round(ST_Distance(ps.location, ds.location)::numeric, 1) AS distance_m
  FROM discovered_store ds
  JOIN tile_fetch tf ON tf.id = ds.tile_fetch_id
  JOIN market_category mc
    ON mc.market_id = psm.market_id AND mc.category_id = tf.category_id
  WHERE ST_DWithin(ps.location, ds.location, $2)
  ORDER BY ST_Distance(ps.location, ds.location)
  LIMIT 1
) nearest ON TRUE
```

## Why these choices

**Metres, which is the whole reason for `geography`.** `ST_DWithin` on two
geography columns takes its third argument in metres. On geometry the same
number would be degrees — 150 of those is most of a hemisphere. This is the
payoff for [ADR-0002](0002-geography-vs-geometry.md), and no migration was
needed because the columns were already right.

**150 m** is roughly a city block. Far enough to absorb the disagreement
between a geocoded address and where OSM put the building, close enough that
two genuinely different shops on the same street do not pair up. It is
configurable because the right number depends on urban density, and the value
is returned in the response so the UI never has to hardcode it.

**Computed, not stored.** A match depends on the discovered stores, which
change whenever a tile is re-fetched. A stored flag would need invalidating on
every discovery run, and would go stale silently in between — the same failure
mode as [ADR-0008](0008-reclassify-markets-on-upload.md), which is one bug of
that shape too many. The lateral join is cheap next to the spatial work the
page already does.

**LATERAL with `LIMIT 1`** so the radius filter runs per portfolio store and
stops at the closest hit, instead of materialising every pair inside the
radius and grouping afterwards.

**Only categories this market selected.** Tiles are shared between markets, so
a neighbouring market can pull a pharmacy into a tile this one also covers.
Matching against it would claim OSM knows about your supermarket because there
is a chemist next door.

## The layer question

A matched store is still inside or outside the boundary, so it belongs to two
layers at once. Rendering it in both would put two pins on one shop.

It renders once, styled by the more specific of the two: while the matched
layer is on, that wins. Turning it off returns the store to its inside/outside
styling rather than hiding it. It disappears only when both of its layers are
off.

That keeps all four checkboxes genuinely independent — every combination is
reachable and means something — without double-drawing anything.

## What it costs

**The match rate looks poor against synthetic data.** The sample portfolios
are invented stores placed on real localities, so almost none have a real OSM
store within 150 m. The layer is nearly always empty for them. That is honest
rather than broken, but it means the feature does not demo well without a
portfolio built from real coordinates.

**It is a proximity heuristic, not identity.** Two supermarkets 100 m apart
match each other regardless of brand. Name similarity would sharpen it, and
would bring its own problems — "Reliance Fresh" against "Reliance SMART" is a
judgement call that a threshold cannot make.

**One more spatial join per dashboard read.** Bounded by the portfolio size
and by stores inside the radius, so it is small today. It shares the
`::geometry` cast problem noted in ADR-0002 only indirectly: this join stays
in geography space, so the GiST index on `discovered_store.location` can serve
it.
