-- Correct coordinates for the original curated Sarajevo seed attractions.
--
-- Each update targets only source = 'manual_seed'. When a matching imported
-- OpenStreetMap row already exists in attractions, its coordinates are used;
-- otherwise the update falls back to approximate landmark coordinates.

BEGIN;

-- Baščaršija
WITH reference AS (
  SELECT latitude, longitude
  FROM attractions
  WHERE source = 'openstreetmap'
    AND (
      LOWER(name) LIKE LOWER('%Baščaršija%')
      OR LOWER(name) LIKE LOWER('%Bascarsija%')
      OR LOWER(name) LIKE LOWER('%Bascar%')
    )
  ORDER BY id
  LIMIT 1
),
coordinate AS (
  SELECT
    COALESCE((SELECT latitude FROM reference), 43.8594000) AS latitude,
    COALESCE((SELECT longitude FROM reference), 18.4316000) AS longitude
)
UPDATE attractions AS manual
SET
  latitude = coordinate.latitude,
  longitude = coordinate.longitude,
  updated_at = CURRENT_TIMESTAMP
FROM coordinate
WHERE manual.source = 'manual_seed'
  AND (
    LOWER(manual.name) LIKE LOWER('%Baščaršija%')
    OR LOWER(manual.name) LIKE LOWER('%Bascarsija%')
    OR LOWER(manual.name) LIKE LOWER('%Bascar%')
  );

-- Latin Bridge
WITH reference AS (
  SELECT latitude, longitude
  FROM attractions
  WHERE source = 'openstreetmap'
    AND (
      LOWER(name) LIKE LOWER('%Latin Bridge%')
      OR LOWER(name) LIKE LOWER('%Latinska%')
      OR LOWER(name) LIKE LOWER('%Latinski%')
    )
  ORDER BY id
  LIMIT 1
),
coordinate AS (
  SELECT
    COALESCE((SELECT latitude FROM reference), 43.8579000) AS latitude,
    COALESCE((SELECT longitude FROM reference), 18.4288000) AS longitude
)
UPDATE attractions AS manual
SET
  latitude = coordinate.latitude,
  longitude = coordinate.longitude,
  updated_at = CURRENT_TIMESTAMP
FROM coordinate
WHERE manual.source = 'manual_seed'
  AND (
    LOWER(manual.name) LIKE LOWER('%Latin Bridge%')
    OR LOWER(manual.name) LIKE LOWER('%Latinska%')
    OR LOWER(manual.name) LIKE LOWER('%Latinski%')
  );

-- Gazi Husrev-beg Mosque
WITH reference AS (
  SELECT latitude, longitude
  FROM attractions
  WHERE source = 'openstreetmap'
    AND (
      LOWER(name) LIKE LOWER('%Gazi Husrev%')
      OR LOWER(name) LIKE LOWER('%Begova%')
    )
  ORDER BY id
  LIMIT 1
),
coordinate AS (
  SELECT
    COALESCE((SELECT latitude FROM reference), 43.8592000) AS latitude,
    COALESCE((SELECT longitude FROM reference), 18.4294000) AS longitude
)
UPDATE attractions AS manual
SET
  latitude = coordinate.latitude,
  longitude = coordinate.longitude,
  updated_at = CURRENT_TIMESTAMP
FROM coordinate
WHERE manual.source = 'manual_seed'
  AND (
    LOWER(manual.name) LIKE LOWER('%Gazi Husrev%')
    OR LOWER(manual.name) LIKE LOWER('%Begova%')
  );

-- Sarajevo City Hall / Vijećnica
WITH reference AS (
  SELECT latitude, longitude
  FROM attractions
  WHERE source = 'openstreetmap'
    AND (
      LOWER(name) LIKE LOWER('%Sarajevo City Hall%')
      OR LOWER(name) LIKE LOWER('%Vijećnica%')
      OR LOWER(name) LIKE LOWER('%Vijecnica%')
    )
  ORDER BY id
  LIMIT 1
),
coordinate AS (
  SELECT
    COALESCE((SELECT latitude FROM reference), 43.8593000) AS latitude,
    COALESCE((SELECT longitude FROM reference), 18.4341000) AS longitude
)
UPDATE attractions AS manual
SET
  latitude = coordinate.latitude,
  longitude = coordinate.longitude,
  updated_at = CURRENT_TIMESTAMP
FROM coordinate
WHERE manual.source = 'manual_seed'
  AND (
    LOWER(manual.name) LIKE LOWER('%Sarajevo City Hall%')
    OR LOWER(manual.name) LIKE LOWER('%Vijećnica%')
    OR LOWER(manual.name) LIKE LOWER('%Vijecnica%')
  );

-- Yellow Fortress / Žuta Tabija
WITH reference AS (
  SELECT latitude, longitude
  FROM attractions
  WHERE source = 'openstreetmap'
    AND (
      LOWER(name) LIKE LOWER('%Yellow Fortress%')
      OR LOWER(name) LIKE LOWER('%Yellow Bastion%')
      OR LOWER(name) LIKE LOWER('%Žuta Tabija%')
      OR LOWER(name) LIKE LOWER('%Zuta Tabija%')
    )
  ORDER BY id
  LIMIT 1
),
coordinate AS (
  SELECT
    COALESCE((SELECT latitude FROM reference), 43.8619000) AS latitude,
    COALESCE((SELECT longitude FROM reference), 18.4433000) AS longitude
)
UPDATE attractions AS manual
SET
  latitude = coordinate.latitude,
  longitude = coordinate.longitude,
  updated_at = CURRENT_TIMESTAMP
FROM coordinate
WHERE manual.source = 'manual_seed'
  AND (
    LOWER(manual.name) LIKE LOWER('%Yellow Fortress%')
    OR LOWER(manual.name) LIKE LOWER('%Yellow Bastion%')
    OR LOWER(manual.name) LIKE LOWER('%Žuta Tabija%')
    OR LOWER(manual.name) LIKE LOWER('%Zuta Tabija%')
  );

-- National Museum of Bosnia and Herzegovina
WITH reference AS (
  SELECT latitude, longitude
  FROM attractions
  WHERE source = 'openstreetmap'
    AND (
      LOWER(name) LIKE LOWER('%National Museum of Bosnia and Herzegovina%')
      OR LOWER(name) LIKE LOWER('%Zemaljski muzej%')
    )
  ORDER BY id
  LIMIT 1
),
coordinate AS (
  SELECT
    COALESCE((SELECT latitude FROM reference), 43.8548000) AS latitude,
    COALESCE((SELECT longitude FROM reference), 18.4023000) AS longitude
)
UPDATE attractions AS manual
SET
  latitude = coordinate.latitude,
  longitude = coordinate.longitude,
  updated_at = CURRENT_TIMESTAMP
FROM coordinate
WHERE manual.source = 'manual_seed'
  AND (
    LOWER(manual.name) LIKE LOWER('%National Museum of Bosnia and Herzegovina%')
    OR LOWER(manual.name) LIKE LOWER('%Zemaljski muzej%')
  );

-- Tunnel of Hope / Sarajevo War Tunnel
WITH reference AS (
  SELECT latitude, longitude
  FROM attractions
  WHERE source = 'openstreetmap'
    AND (
      LOWER(name) LIKE LOWER('%Tunnel of Hope%')
      OR LOWER(name) LIKE LOWER('%Sarajevo War Tunnel%')
      OR LOWER(name) LIKE LOWER('%Tunel spasa%')
      OR LOWER(name) LIKE LOWER('%Ratni tunel%')
    )
  ORDER BY id
  LIMIT 1
),
coordinate AS (
  SELECT
    COALESCE((SELECT latitude FROM reference), 43.8198000) AS latitude,
    COALESCE((SELECT longitude FROM reference), 18.3370000) AS longitude
)
UPDATE attractions AS manual
SET
  latitude = coordinate.latitude,
  longitude = coordinate.longitude,
  updated_at = CURRENT_TIMESTAMP
FROM coordinate
WHERE manual.source = 'manual_seed'
  AND (
    LOWER(manual.name) LIKE LOWER('%Tunnel of Hope%')
    OR LOWER(manual.name) LIKE LOWER('%Sarajevo War Tunnel%')
    OR LOWER(manual.name) LIKE LOWER('%Tunel spasa%')
    OR LOWER(manual.name) LIKE LOWER('%Ratni tunel%')
  );

-- Sebilj Fountain
WITH reference AS (
  SELECT latitude, longitude
  FROM attractions
  WHERE source = 'openstreetmap'
    AND LOWER(name) LIKE LOWER('%Sebilj%')
  ORDER BY id
  LIMIT 1
),
coordinate AS (
  SELECT
    COALESCE((SELECT latitude FROM reference), 43.867889) AS latitude,
    COALESCE((SELECT longitude FROM reference), 18.433127) AS longitude
)
UPDATE attractions AS manual
SET
  latitude = coordinate.latitude,
  longitude = coordinate.longitude,
  updated_at = CURRENT_TIMESTAMP
FROM coordinate
WHERE manual.source = 'manual_seed'
  AND LOWER(manual.name) LIKE LOWER('%Sebilj%');

-- Vrelo Bosne
WITH reference AS (
  SELECT latitude, longitude
  FROM attractions
  WHERE source = 'openstreetmap'
    AND LOWER(name) LIKE LOWER('%Vrelo Bosne%')
  ORDER BY id
  LIMIT 1
),
coordinate AS (
  SELECT
    COALESCE((SELECT latitude FROM reference), 43.8190000) AS latitude,
    COALESCE((SELECT longitude FROM reference), 18.2700000) AS longitude
)
UPDATE attractions AS manual
SET
  latitude = coordinate.latitude,
  longitude = coordinate.longitude,
  updated_at = CURRENT_TIMESTAMP
FROM coordinate
WHERE manual.source = 'manual_seed'
  AND LOWER(manual.name) LIKE LOWER('%Vrelo Bosne%');

-- Avaz Twist Tower
WITH reference AS (
  SELECT latitude, longitude
  FROM attractions
  WHERE source = 'openstreetmap'
    AND (
      LOWER(name) LIKE LOWER('%Avaz Twist%')
      OR LOWER(name) LIKE LOWER('%Avaz Tower%')
    )
  ORDER BY id
  LIMIT 1
),
coordinate AS (
  SELECT
    COALESCE((SELECT latitude FROM reference), 43.8607000) AS latitude,
    COALESCE((SELECT longitude FROM reference), 18.4044000) AS longitude
)
UPDATE attractions AS manual
SET
  latitude = coordinate.latitude,
  longitude = coordinate.longitude,
  updated_at = CURRENT_TIMESTAMP
FROM coordinate
WHERE manual.source = 'manual_seed'
  AND (
    LOWER(manual.name) LIKE LOWER('%Avaz Twist%')
    OR LOWER(manual.name) LIKE LOWER('%Avaz Tower%')
  );

COMMIT;

-- Verification:
-- SELECT id, name, latitude, longitude, source
-- FROM attractions
-- WHERE source = 'manual_seed'
-- ORDER BY name;
