// Pure information-retrieval metric functions for binary relevance.
// All functions handle edge cases: empty lists, K > list length, empty relevant sets.

/** K values used consistently across the evaluation. */
export const K_VALUES = [5, 10] as const;
export type KValue = (typeof K_VALUES)[number];

/**
 * Precision@K = |relevant ∩ top-K| / K
 * Returns 0 when K = 0.
 */
export function precisionAtK(
  rankedIds: number[],
  relevantSet: Set<number>,
  k: number
): number {
  if (k <= 0) return 0;
  const topK = rankedIds.slice(0, k);
  const hits = topK.filter((id) => relevantSet.has(id)).length;
  return hits / k;
}

/**
 * Recall@K = |relevant ∩ top-K| / |relevantSet|
 * Returns 0 when relevantSet is empty (N/A case — callers should exclude these
 * from mean recall computation and note the exclusion count).
 */
export function recallAtK(
  rankedIds: number[],
  relevantSet: Set<number>,
  k: number
): number {
  if (relevantSet.size === 0) return 0;
  const topK = rankedIds.slice(0, k);
  const hits = topK.filter((id) => relevantSet.has(id)).length;
  return hits / relevantSet.size;
}

/**
 * nDCG@K with binary relevance (rel ∈ {0, 1}).
 * DCG@K  = Σ_{i=1}^{min(K,|list|)} rel_i / log2(i + 1)
 * IDCG@K = Σ_{i=1}^{min(K,|relevant|)} 1 / log2(i + 1)
 * Returns 0 when relevantSet is empty or the list is empty.
 */
export function ndcgAtK(
  rankedIds: number[],
  relevantSet: Set<number>,
  k: number
): number {
  if (relevantSet.size === 0 || rankedIds.length === 0 || k <= 0) return 0;

  const effectiveK = Math.min(k, rankedIds.length);

  let dcg = 0;
  for (let i = 0; i < effectiveK; i++) {
    if (relevantSet.has(rankedIds[i])) {
      dcg += 1 / Math.log2(i + 2); // position i+1, so log2(position + 1) = log2(i + 2)
    }
  }

  const idealK = Math.min(k, relevantSet.size);
  let idcg = 0;
  for (let i = 0; i < idealK; i++) {
    idcg += 1 / Math.log2(i + 2);
  }

  return idcg === 0 ? 0 : dcg / idcg;
}
