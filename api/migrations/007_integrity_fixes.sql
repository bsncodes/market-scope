-- Up Migration

-- Derived classification, not source data: when either parent goes the row is
-- meaningless. Without this a processed market was undeletable.
ALTER TABLE portfolio_store_market
  DROP CONSTRAINT portfolio_store_market_market_id_fkey,
  ADD CONSTRAINT portfolio_store_market_market_id_fkey
    FOREIGN KEY (market_id) REFERENCES market(id) ON DELETE CASCADE;

ALTER TABLE portfolio_store_market
  DROP CONSTRAINT portfolio_store_market_portfolio_store_id_fkey,
  ADD CONSTRAINT portfolio_store_market_portfolio_store_id_fkey
    FOREIGN KEY (portfolio_store_id) REFERENCES portfolio_store(id) ON DELETE CASCADE;

-- All four are written together from one Nominatim response, so a partial row
-- is always a bug and makes "is this city cached?" unanswerable.
ALTER TABLE city
  ADD CONSTRAINT city_bbox_all_or_none
    CHECK (num_nonnulls(min_lat, min_lng, max_lat, max_lng) IN (0, 4)),
  ADD CONSTRAINT city_bbox_in_range
    CHECK (
      min_lat IS NULL OR (
        min_lat BETWEEN -90 AND 90 AND max_lat BETWEEN -90 AND 90 AND
        min_lng BETWEEN -180 AND 180 AND max_lng BETWEEN -180 AND 180
      )
    ),
  ADD CONSTRAINT city_bbox_ordered
    CHECK (min_lat IS NULL OR (min_lat <= max_lat AND min_lng <= max_lng));

-- Drives the dashboard's "Discovered <date>" label. Separate from updated_at,
-- which the trigger bumps on any row change and so can't mean "data age".
ALTER TABLE market ADD COLUMN last_discovered_at TIMESTAMPTZ;

-- Down Migration

ALTER TABLE market DROP COLUMN IF EXISTS last_discovered_at;

ALTER TABLE city
  DROP CONSTRAINT IF EXISTS city_bbox_ordered,
  DROP CONSTRAINT IF EXISTS city_bbox_in_range,
  DROP CONSTRAINT IF EXISTS city_bbox_all_or_none;

ALTER TABLE portfolio_store_market
  DROP CONSTRAINT portfolio_store_market_portfolio_store_id_fkey,
  ADD CONSTRAINT portfolio_store_market_portfolio_store_id_fkey
    FOREIGN KEY (portfolio_store_id) REFERENCES portfolio_store(id);

ALTER TABLE portfolio_store_market
  DROP CONSTRAINT portfolio_store_market_market_id_fkey,
  ADD CONSTRAINT portfolio_store_market_market_id_fkey
    FOREIGN KEY (market_id) REFERENCES market(id);
