-- Up Migration

-- Progress lives in Postgres rather than BullMQ's job state so the status
-- endpoint reads one row and never touches Redis. BullMQ owns transient
-- execution state; this is the durable projection the frontend polls, and it
-- survives a queue restart or a flushed Redis.
ALTER TABLE market ADD COLUMN progress JSONB;

-- Down Migration

ALTER TABLE market DROP COLUMN IF EXISTS progress;
