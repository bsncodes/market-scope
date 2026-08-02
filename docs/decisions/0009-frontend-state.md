# ADR-0009 — No state library on the frontend

**Status:** accepted
**Affects:** `app/src/hooks/useRequest.ts`, `app/src/pages/`

## Context

Six screens, all of which need to fetch something, show a spinner, and handle
an error. The reflex is Redux, Zustand, or TanStack Query.

## Decision

None of them. Local `useState` per page, plus one shared hook — `useRequest` —
that owns the loading/error/data triple and cancels superseded responses.

## Why

Nothing is genuinely shared between screens. The dashboard needs a market, the
setup page needs reference data, the portfolio page needs the portfolio, and
no two of them need the same thing at the same time. A store would be a place
to put data that only ever has one reader.

TanStack Query would be a reasonable choice — caching, deduplication and
invalidation are real problems it solves well. At six screens the parts we
actually need come to about sixty lines, and the parts we do not need are
still API surface a reviewer has to read past. At twenty screens the balance
tips the other way, and it is worth saying that explicitly rather than
pretending the decision generalises.

## The one non-obvious thing `useRequest` does

It takes a **key string**, not a dependency array:

```ts
const cities = useRequest(
  `cities:${stateId}`,
  stateId ? () => listCities(stateId) : null,
);
```

An earlier version took an array and spread it into the effect's dependencies.
That made the array's _length_ caller-controlled, and React throws outright if
that length ever changes between renders. It also meant a forgotten dependency
was invisible — the fetcher would close over a stale value and keep serving it
with nothing to indicate anything was wrong.

A key has to be built from whatever the fetcher reads, so omitting something
shows up as a key that obviously ignores it.

The superseded-response guard is the other thing worth keeping. Pick state A,
then quickly state B: A's slower response can land last and put A's cities
under B's name. There is a test for exactly that, using two deferred promises
resolved out of order.

## What it costs

No cross-screen cache. Navigating from the dashboard to a market and back
re-fetches the market list. At this scale that is one fast query and nobody
notices; it is the first thing that would hurt if the app grew.
