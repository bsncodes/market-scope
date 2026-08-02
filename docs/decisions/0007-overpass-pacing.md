# ADR-0007 — Pacing Overpass, measured rather than assumed

**Status:** accepted
**Affects:** `api/src/controllers/overpass.ts`, `api/src/http.ts`, `api/src/config.ts`

## Context

Discovery started failing badly during testing — 30 of 34 attempted tiles
failing on one market. The initial read was that the public Overpass instance
had blocked the IP, because a connection probe came back refused.

That was wrong, and the way it was wrong is the useful part. The probe ran
inside a sandbox with its own network restrictions. Run from the actual
machine, `overpass-api.de` answered fine, and `/api/status` reported _two
slots available_ with no penalty of any kind. Nothing was blocked.

## What was actually measured

Twelve tile-sized queries against the public instance, paced at roughly one
every two seconds:

```
200 200 429 200 200 200 200 200 200 504 504 200
first attempt: 6/12 succeeded
after one retry: 9/12
```

50% first-attempt failures, a mix of 429 (rate limited) and 504 (gateway
timeout at about ten seconds against a `[timeout:60]` budget — the instance
being busy, not the query being too expensive).

One confound worth recording: the discovery worker was running during that
sample, so two processes were competing for the two available slots. Some of
that 50% was self-inflicted.

## Decision

Four changes, three of them in code rather than config.

**Honour `Retry-After`.** It was being ignored entirely. When Overpass answers
429 it says how long to wait; retrying on a locally-chosen three seconds
instead is how one rate-limit response becomes a run of them. `HttpError` now
carries the header, parsed from either delta-seconds or an HTTP date, capped
by `OVERPASS_MAX_BACKOFF_MS` so one tile's long wait cannot park a whole
market.

**Exponential backoff with jitter,** replacing a flat multiple of the attempt
number. With a fixed delay, every tile that failed in the same bad window
retries in the same instant, recreating the burst that caused the failure.

**Make the queried element types configurable.** `relation` resolved through
`out center` is by far the most expensive clause, so dropping it is the lever
to reach for when a loaded server returns 504s. The default keeps all three,
because a shop mapped as a multipolygon is rare but real.

**Slow the sustained rate** to 0.25/sec with a burst of 1, and raise the tile
size to 1.5 km, which cuts the request count per market by well over half.

## The arithmetic

Retry rate is `1 − p`, where `p` is first-attempt success. No amount of
retrying lowers it; only making the first attempt more likely to succeed does.
Final success with `n` attempts is `1 − (1−p)ⁿ`.

| p                  | success (3 attempts) | retry rate |
| ------------------ | -------------------- | ---------- |
| 0.50 (as measured) | 87.5%                | 50%        |
| 0.70               | 97.3%                | 30%        |
| 0.75               | 98.4%                | 25%        |
| 0.80               | 99.2%                | 20%        |

So a 90% success target clears at `p ≥ 0.54` and is easy. A 25% retry-rate
target needs `p ≥ 0.75` and is the binding constraint — which is why the
changes above aim at first-attempt success rather than at retrying harder.

## Honesty about what is verified

The table is a model built on one twelve-request sample that was confounded by
a competing worker. The configuration has been confirmed working in practice
by hand, but the projected first-attempt rate under the new settings has not
been measured. Treat 0.75 as the target the arithmetic demands, not as an
observation.

## What it costs

A market at the 30 sq km cap covers 20 tiles, so three categories is 60
requests at four seconds apart — four minutes before retries, and a single
category is about eighty seconds. Slower than it needs to be on a quiet day,
which is the price of not being cut off on a busy one.
