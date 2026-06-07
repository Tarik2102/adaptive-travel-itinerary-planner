# Recommendation-Relevance Evaluation (RP#2) — Cold-Start

*Framing: 6 personas × 3 recommenders (content / popularity / random). Cold-start: personas have stated preferences but NO interaction history. Candidate pool: all active attractions in DB (302 total). Metric values are means across 6 personas.*

## Results

| Recommender | P@5   | P@10  | R@5   | R@10  | nDCG@5 | nDCG@10 |
|-------------|-------|-------|-------|-------|--------|---------|
| content    | 0.867 | 0.833 | 0.108 | 0.183 | 0.869 | 0.849 |
| popularity | 0.667 | 0.667 | 0.023 | 0.046 | 0.667 | 0.667 |
| random     | 0.267 | 0.217 | 0.009 | 0.027 | 0.201 | 0.188 |

## Notes

- **Relevance threshold**: `RELEVANCE_MIN_RATING = 4`. An attraction is relevant for a persona when its `primary_category` / `category` / `secondary_categories` / `tags` match ≥1 requested interest AND (`rating ≥ 4`) OR (rating absent/zero → `data_quality_score ≥ median`).
- **K values**: 5, 10.
- **Random recommender** uses `EVAL_SEED = 42` (mulberry32 PRNG) for full reproducibility.
- No personas had an empty relevant set.
