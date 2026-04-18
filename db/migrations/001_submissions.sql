-- Run once against your Neon database (SQL Editor or psql with DATABASE_URL).

CREATE TABLE IF NOT EXISTS submissions (
  id UUID PRIMARY KEY,
  captured_at TIMESTAMPTZ NOT NULL,
  location TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  image_path TEXT NOT NULL,
  user_agent TEXT,
  client_info TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS submissions_location_captured_at_idx
  ON submissions (location, captured_at DESC);

CREATE INDEX IF NOT EXISTS submissions_captured_at_idx
  ON submissions (captured_at DESC);
