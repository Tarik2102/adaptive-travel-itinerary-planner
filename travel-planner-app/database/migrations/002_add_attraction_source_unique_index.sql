CREATE UNIQUE INDEX IF NOT EXISTS attractions_source_source_id_unique
ON attractions (source, source_id)
WHERE source IS NOT NULL AND source_id IS NOT NULL;