-- Up Migration

CREATE TABLE country (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  iso_code   TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE state (
  id         BIGSERIAL PRIMARY KEY,
  country_id BIGINT NOT NULL REFERENCES country(id),
  name       TEXT NOT NULL,
  code       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (country_id, code)
);

CREATE INDEX idx_state_country_id ON state(country_id);

CREATE TABLE city (
  id         BIGSERIAL PRIMARY KEY,
  state_id   BIGINT NOT NULL REFERENCES state(id),
  name       TEXT NOT NULL,
  min_lat    DOUBLE PRECISION,
  min_lng    DOUBLE PRECISION,
  max_lat    DOUBLE PRECISION,
  max_lng    DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (state_id, name)
);

CREATE INDEX idx_city_state_id ON city(state_id);

-- Down Migration

DROP TABLE IF EXISTS city;
DROP TABLE IF EXISTS state;
DROP TABLE IF EXISTS country;
