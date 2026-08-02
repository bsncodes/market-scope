# ADR-0006 — Token bucket, not a fixed interval

**Status:** accepted
**Affects:** `api/src/helpers/rateLimiter.ts`

## Context

Both upstreams are free public services with fair-use limits. The first
implementation was a fixed 1100 ms sleep between Nominatim calls. It worked
and it was four lines.

## Decision

A token bucket per service: a capacity for bursts, a refill rate for sustained
throughput, and a FIFO queue of waiters.

## Why

A fixed interval cannot express "one per second, but two right now is fine".
Overpass grants two concurrent slots, so a small burst is legitimate — and
under a fixed interval, a run that has been idle for a minute still crawls
from a standing start.

The bucket separates the two concerns properly. `capacity` is what may burst;
`refillPerSecond` is what is sustainable. Nominatim is configured at 0.9/sec
with a capacity of 1, which is a fixed interval expressed in the general form.
Overpass is 0.25/sec with a capacity of 1.

FIFO matters more than it looks. Without ordering, a waiter can starve while
later arrivals take the tokens — over a forty-tile market that shows up as one
tile that mysteriously never completes.

The refill is clamped to capacity. Without the clamp, an idle bucket
accumulates unbounded tokens and the next burst ignores the limit entirely,
which is the failure mode most likely to get an IP blocked.

## The 0.9 is not a typo

Nominatim's policy is an absolute maximum of one request per second. Running
at exactly 1.0 leaves no room for timing jitter — a slow event loop tick or a
badly-timed GC pause can put two requests inside the same wall-clock second,
and the service is within its rights to cut us off for it. 0.9/sec spaces them
about 1.11 s apart, the same margin the original fixed interval had.

That margin was briefly lost when the token bucket replaced the sleep, and
restored once the regression was noticed. It is worth stating because "the
rate limiter is exactly at the documented limit" reads like correctness and is
actually the bug.

## What it costs

The limiter is per process, so it bounds one worker rather than the
application. Two workers means twice the real rate. Fixing that needs a
Redis-backed bucket; the constraint is documented at the point in the source
where somebody would otherwise raise concurrency and cause it.
