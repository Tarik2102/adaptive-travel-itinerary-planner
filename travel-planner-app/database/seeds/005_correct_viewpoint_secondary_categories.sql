-- Remove "Viewpoint" from secondary_categories on attractions whose tags carry
-- no genuine viewpoint evidence (viewpoint, panorama, lookout, scenic, observation
-- deck) and whose primary_category is not Viewpoint.
--
-- The rule catches any manual_seed attraction that was incorrectly labelled as a
-- secondary viewpoint: e.g. Sebilj Fountain (an Ottoman fountain) and Vrelo Bosne
-- (a river-source nature park), both of which had "Viewpoint" in their secondary
-- categories despite having no elevated/scenic vantage point.
--
-- Attractions with genuine viewpoint tags (Avaz Twist Tower: viewpoint, panorama,
-- observation deck) are unaffected because their tags satisfy the evidence check.
UPDATE attractions
SET secondary_categories = array_remove(secondary_categories, 'Viewpoint')
WHERE 'Viewpoint' = ANY(secondary_categories)
  AND primary_category != 'Viewpoint'
  AND NOT (tags && ARRAY['viewpoint', 'panorama', 'lookout', 'scenic', 'observation deck']);
