-- Up Migration

CREATE TABLE geocode_cache (
  id                 BIGSERIAL PRIMARY KEY,
  normalized_address TEXT NOT NULL UNIQUE,
  location           geography(POINT, 4326) NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tile_fetch (
  id          BIGSERIAL PRIMARY KEY,
  tile_key    TEXT NOT NULL,
  category_id BIGINT NOT NULL REFERENCES category(id),
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tile_key, category_id)
);

CREATE INDEX idx_tile_fetch_fetched_at ON tile_fetch(fetched_at);

CREATE TABLE discovered_store (
  id             BIGSERIAL PRIMARY KEY,
  tile_fetch_id  BIGINT NOT NULL REFERENCES tile_fetch(id) ON DELETE CASCADE,
  osm_element_id TEXT NOT NULL,
  name           TEXT,
  category_value TEXT,
  location       geography(POINT, 4326) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tile_fetch_id, osm_element_id)
);

CREATE INDEX idx_discovered_store_tile_fetch_id ON discovered_store(tile_fetch_id);
CREATE INDEX idx_discovered_store_location ON discovered_store USING GIST(location);

-- Down Migration

DROP TABLE IF EXISTS discovered_store;
DROP TABLE IF EXISTS tile_fetch;
DROP TABLE IF EXISTS geocode_cache;
