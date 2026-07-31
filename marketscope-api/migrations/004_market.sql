-- Up Migration

CREATE TABLE market (
  id         BIGSERIAL PRIMARY KEY,
  city_id    BIGINT NOT NULL REFERENCES city(id) ON DELETE RESTRICT,
  boundary   geometry(POLYGON, 4326) NOT NULL,
  status     TEXT NOT NULL DEFAULT 'queued'
             CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  error      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT market_boundary_valid CHECK (ST_IsValid(boundary))
);

CREATE INDEX idx_market_city_id ON market(city_id);
CREATE INDEX idx_market_boundary ON market USING GIST(boundary);

CREATE TRIGGER trg_market_set_updated_at
  BEFORE UPDATE ON market
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

CREATE TABLE market_category (
  market_id   BIGINT NOT NULL REFERENCES market(id) ON DELETE CASCADE,
  category_id BIGINT NOT NULL REFERENCES category(id) ON DELETE RESTRICT,
  PRIMARY KEY (market_id, category_id)
);

-- Down Migration

DROP TABLE IF EXISTS market_category;
DROP TRIGGER IF EXISTS trg_market_set_updated_at ON market;
DROP TABLE IF EXISTS market;
