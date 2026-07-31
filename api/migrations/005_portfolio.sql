-- Up Migration

CREATE TABLE portfolio_store (
  id         BIGSERIAL PRIMARY KEY,
  store_name TEXT NOT NULL,
  address    TEXT,
  city       TEXT,
  state      TEXT,
  country    TEXT,
  category   TEXT,
  location   geography(POINT, 4326),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_portfolio_store_location ON portfolio_store USING GIST(location);

CREATE TABLE portfolio_store_market (
  market_id         BIGINT NOT NULL REFERENCES market(id),
  portfolio_store_id BIGINT NOT NULL REFERENCES portfolio_store(id),
  is_inside         BOOLEAN NOT NULL,
  PRIMARY KEY (market_id, portfolio_store_id)
);

-- Down Migration

DROP TABLE IF EXISTS portfolio_store_market;
DROP TABLE IF EXISTS portfolio_store;
