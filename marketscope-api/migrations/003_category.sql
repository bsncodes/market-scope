-- Up Migration

CREATE TABLE category (
  id         BIGSERIAL PRIMARY KEY,
  label      TEXT NOT NULL UNIQUE,
  value      TEXT[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT category_value_not_empty CHECK (array_length(value, 1) > 0)
);

-- Down Migration

DROP TABLE IF EXISTS category;
