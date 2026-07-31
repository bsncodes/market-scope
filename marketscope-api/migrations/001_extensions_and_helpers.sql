-- Up Migration

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Down Migration

DROP FUNCTION IF EXISTS set_updated_at();

-- CASCADE: the postgis/postgis Docker image's own init scripts install
-- postgis_topology and postgis_tiger_geocoder into every new database
-- alongside postgis, and both depend on it. This migration never created
-- those two, but a bare DROP EXTENSION postgis fails because of them, so
-- CASCADE is required for `migrate down` to actually be reversible.
DROP EXTENSION IF EXISTS postgis CASCADE;
