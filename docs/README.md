# Documentation

Start with the [project README](../README.md) if you want to run this. These
are the documents for reading the code rather than using it.

| Document                                  | Read it for                                                         |
| ----------------------------------------- | ------------------------------------------------------------------- |
| [Architecture](architecture.md)           | How the pieces fit, the data model, and why there are two processes |
| [Technical specification](tech-spec.md)   | Schema, endpoints, config, error shapes                             |
| [Sequence diagrams](sequence-diagrams.md) | Upload, market creation, discovery, polling                         |
| [Flowcharts](flowcharts.md)               | Tiling, geocode filtering, dashboard reads, status transitions      |
| [Decision records](decisions/)            | Why each significant choice was made, and what it cost              |

## Decision records

| #                                                            | Decision                                           |
| ------------------------------------------------------------ | -------------------------------------------------- |
| [0001](decisions/0001-openstreetmap-over-commercial-apis.md) | OpenStreetMap over a commercial places API         |
| [0002](decisions/0002-geography-vs-geometry.md)              | `geography` for points, `geometry` for boundaries  |
| [0003](decisions/0003-tile-based-caching.md)                 | Tile-based caching, keyed to the world             |
| [0004](decisions/0004-async-discovery-queue.md)              | Discovery runs on a queue, in a separate process   |
| [0005](decisions/0005-two-cache-lifetimes.md)                | Geocodes never expire, tiles go stale in five days |
| [0006](decisions/0006-token-bucket-rate-limiting.md)         | Token bucket, not a fixed interval                 |
| [0007](decisions/0007-overpass-pacing.md)                    | Pacing Overpass, measured rather than assumed      |
| [0008](decisions/0008-reclassify-markets-on-upload.md)       | Re-uploading a portfolio reclassifies every market |
| [0009](decisions/0009-frontend-state.md)                     | No state library on the frontend                   |

Each record states what was decided, why, what was rejected, and what the
choice costs. The last section is the one worth reading — a decision without a
stated cost usually means the alternatives were not taken seriously.

## Build history

`../cycles/` holds the five build cycles this was developed in, with the exit
criteria for each and notes on what verification actually turned up. They are
working documents rather than polished ones, but they record the order things
were built in and why, which the finished code cannot.
