# ADR-0001 — OpenStreetMap over a commercial places API

**Status:** accepted
**Affects:** `api/src/controllers/overpass.ts`, `api/src/helpers/overpass.ts`

## Context

The core feature is "find retail stores inside this boundary". The obvious
candidates were Google Places, Foursquare, HERE, or OpenStreetMap through
Overpass.

## Decision

OpenStreetMap via the Overpass API.

## Why

Cost and reviewability, mostly. A commercial API needs a billing account and a
key, which means a reviewer cannot clone this repository and run it. Google
Places also charges per request, and the discovery engine's whole design —
tile caching, deliberate over-fetching, retries — would have been shaped by
"how do we not spend money" rather than "how do we not get rate limited".
Those pull in different directions, and the second is more interesting to
solve in the open.

OSM's licence also allows caching results in our own database, which is the
foundation of the tile cache. Google's terms restrict how long Places data may
be stored, which would have made `tile_fetch` a licence problem rather than an
engineering one.

## What it costs

OSM's coverage is uneven and its tagging is inconsistent. A shop mapped as
`shop=convenience` in one neighbourhood might be `shop=supermarket` two
streets away, and small independents are frequently missing entirely. That is
the honest headline limitation of the whole project and it is stated as such
in the README.

The category taxonomy is ours, mapping labels like "Pharmacy" onto tag
expressions like `amenity=pharmacy`. It is stored in the `category` table
rather than in code, so widening a category is a data change. Concretely,
`shop=department_store` is barely used in Indian OSM data — a real query over
central Bengaluru returned 38 supermarkets and 2 department stores — so a
market for department stores looks almost empty, and that is the data's fault
rather than a bug.

There is no SLA. The public Overpass instance can and does refuse service, and
[ADR-0007](0007-overpass-pacing.md) is entirely about living with that.
