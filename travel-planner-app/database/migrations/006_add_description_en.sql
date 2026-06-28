ALTER TABLE attractions ADD COLUMN IF NOT EXISTS description_en TEXT;
ALTER TABLE attractions ADD COLUMN IF NOT EXISTS description_en_source VARCHAR(50);
