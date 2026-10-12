CREATE TABLE IF NOT EXISTS wishlist (
  id                     serial PRIMARY KEY,
  itad_id                text NOT NULL UNIQUE,
  title                  text NOT NULL,
  target_price_cents     integer,
  history_low_cents      integer,
  -- Price we last alerted at; prevents re-alerting on every poll run
  last_alert_price_cents integer,
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- One row per shop per poll run. All rows from one run share fetched_at.
CREATE TABLE IF NOT EXISTS price_snapshots (
  id            bigserial PRIMARY KEY,
  game_id       integer NOT NULL REFERENCES wishlist(id) ON DELETE CASCADE,
  shop          text NOT NULL,
  price_cents   integer NOT NULL,
  regular_cents integer NOT NULL,
  currency      text NOT NULL,
  cut           integer NOT NULL,
  url           text NOT NULL,
  fetched_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS price_snapshots_game_time
  ON price_snapshots (game_id, fetched_at DESC);
