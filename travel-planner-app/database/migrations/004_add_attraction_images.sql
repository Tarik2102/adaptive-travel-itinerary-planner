CREATE TABLE IF NOT EXISTS attraction_images (
  id SERIAL PRIMARY KEY,
  attraction_id INTEGER NOT NULL REFERENCES attractions(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  thumbnail_url TEXT,
  source TEXT NOT NULL,
  source_page TEXT,
  title TEXT,
  author TEXT,
  license TEXT,
  attribution TEXT,
  width INTEGER,
  height INTEGER,
  sort_order INTEGER DEFAULT 0,
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS attraction_images_attraction_id_idx
  ON attraction_images (attraction_id);

CREATE UNIQUE INDEX IF NOT EXISTS attraction_images_attraction_url_unique
  ON attraction_images (attraction_id, image_url);

ALTER TABLE attractions
  ADD COLUMN IF NOT EXISTS image_url TEXT;
