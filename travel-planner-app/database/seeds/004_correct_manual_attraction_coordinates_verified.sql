-- Correct manually verified coordinates for the 10 original manual Sarajevo attractions.
-- This seed updates only source = 'manual_seed' rows and does not modify imported OSM rows.

BEGIN;

-- Sebilj Fountain
UPDATE attractions
SET
  latitude = 43.86000980650076,
  longitude = 18.431356327303963,
  updated_at = CURRENT_TIMESTAMP
WHERE source = 'manual_seed'
  AND LOWER(name) LIKE LOWER('%Sebilj%');

-- Avaz Twist Tower / Avaz Tower
UPDATE attractions
SET
  latitude = 43.86093380753682,
  longitude = 18.40217999800337,
  updated_at = CURRENT_TIMESTAMP
WHERE source = 'manual_seed'
  AND (
    LOWER(name) LIKE LOWER('%Avaz%')
    OR LOWER(name) LIKE LOWER('%Twist Tower%')
    OR LOWER(name) LIKE LOWER('%Avaz Tower%')
  );

-- Vrelo Bosne
UPDATE attractions
SET
  latitude = 43.81895087911155,
  longitude = 18.26800790853944,
  updated_at = CURRENT_TIMESTAMP
WHERE source = 'manual_seed'
  AND LOWER(name) LIKE LOWER('%Vrelo Bosne%');

-- Yellow Fortress / Žuta Tabija
UPDATE attractions
SET
  latitude = 43.86154618971101,
  longitude = 18.437644227203073,
  updated_at = CURRENT_TIMESTAMP
WHERE source = 'manual_seed'
  AND (
    LOWER(name) LIKE LOWER('%Yellow Fortress%')
    OR LOWER(name) LIKE LOWER('%Žuta Tabija%')
    OR LOWER(name) LIKE LOWER('%Zuta Tabija%')
  );

-- Gazi Husrev-beg Mosque / Gazi-Husrev beg Mosque
UPDATE attractions
SET
  latitude = 43.859246166431625,
  longitude = 18.429312549725367,
  updated_at = CURRENT_TIMESTAMP
WHERE source = 'manual_seed'
  AND (
    LOWER(name) LIKE LOWER('%Gazi Husrev%')
    OR LOWER(name) LIKE LOWER('%Gazi-Husrev%')
    OR LOWER(name) LIKE LOWER('%Beg Mosque%')
    OR LOWER(name) LIKE LOWER('%Husrev-beg%')
    OR LOWER(name) LIKE LOWER('%Husrev beg%')
  );

-- National Museum of Bosnia and Herzegovina
UPDATE attractions
SET
  latitude = 43.85525226227025,
  longitude = 18.402733490047353,
  updated_at = CURRENT_TIMESTAMP
WHERE source = 'manual_seed'
  AND (
    LOWER(name) LIKE LOWER('%National Museum%')
    OR LOWER(name) LIKE LOWER('%Zemaljski Muzej%')
  );

-- Tunnel of Hope / Sarajevo War Tunnel
UPDATE attractions
SET
  latitude = 43.81994319253101,
  longitude = 18.33727662359977,
  updated_at = CURRENT_TIMESTAMP
WHERE source = 'manual_seed'
  AND (
    LOWER(name) LIKE LOWER('%Tunnel of Hope%')
    OR LOWER(name) LIKE LOWER('%Sarajevo War Tunnel%')
    OR LOWER(name) LIKE LOWER('%War Tunnel%')
  );

-- Sarajevo City Hall / Vijećnica
UPDATE attractions
SET
  latitude = 43.85915491325748,
  longitude = 18.433610522302953,
  updated_at = CURRENT_TIMESTAMP
WHERE source = 'manual_seed'
  AND (
    LOWER(name) LIKE LOWER('%Sarajevo City Hall%')
    OR LOWER(name) LIKE LOWER('%City Hall%')
    OR LOWER(name) LIKE LOWER('%Vijećnica%')
    OR LOWER(name) LIKE LOWER('%Vijecnica%')
  );

-- Latin Bridge
UPDATE attractions
SET
  latitude = 43.857736025428636,
  longitude = 18.42899491232299,
  updated_at = CURRENT_TIMESTAMP
WHERE source = 'manual_seed'
  AND (
    LOWER(name) LIKE LOWER('%Latin Bridge%')
    OR LOWER(name) LIKE LOWER('%Latinska%')
  );

-- Baščaršija
UPDATE attractions
SET
  latitude = 43.860063304901416,
  longitude = 18.431324143473894,
  updated_at = CURRENT_TIMESTAMP
WHERE source = 'manual_seed'
  AND (
    LOWER(name) LIKE LOWER('%Baščaršija%')
    OR LOWER(name) LIKE LOWER('%Bascarsija%')
    OR LOWER(name) LIKE LOWER('%Bašcaršija%')
  );

COMMIT;

-- Verification 1:
-- SELECT id, name, latitude, longitude, source, updated_at
-- FROM attractions
-- WHERE source = 'manual_seed'
-- ORDER BY name;

-- Verification 2:
-- SELECT COUNT(*) AS updated_manual_rows
-- FROM attractions
-- WHERE source = 'manual_seed'
--   AND (
--     (LOWER(name) LIKE LOWER('%Sebilj%') AND latitude = 43.86000980650076 AND longitude = 18.431356327303963)
--     OR (LOWER(name) LIKE LOWER('%Avaz%') AND latitude = 43.86093380753682 AND longitude = 18.40217999800337)
--     OR (LOWER(name) LIKE LOWER('%Vrelo Bosne%') AND latitude = 43.81895087911155 AND longitude = 18.26800790853944)
--     OR (LOWER(name) LIKE LOWER('%Yellow Fortress%') AND latitude = 43.86154618971101 AND longitude = 18.437644227203073)
--     OR (LOWER(name) LIKE LOWER('%Gazi Husrev%') AND latitude = 43.859246166431625 AND longitude = 18.429312549725367)
--     OR (LOWER(name) LIKE LOWER('%National Museum%') AND latitude = 43.85525226227025 AND longitude = 18.402733490047353)
--     OR (LOWER(name) LIKE LOWER('%Tunnel of Hope%') AND latitude = 43.81994319253101 AND longitude = 18.33727662359977)
--     OR (LOWER(name) LIKE LOWER('%City Hall%') AND latitude = 43.85915491325748 AND longitude = 18.433610522302953)
--     OR (LOWER(name) LIKE LOWER('%Latin Bridge%') AND latitude = 43.857736025428636 AND longitude = 18.42899491232299)
--     OR (LOWER(name) LIKE LOWER('%Baščaršija%') AND latitude = 43.860063304901416 AND longitude = 18.431324143473894)
--   );
