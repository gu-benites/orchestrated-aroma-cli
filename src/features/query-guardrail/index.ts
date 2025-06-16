// src/features/query-guardrail/index.ts

/**
 * This barrel file exports the public-facing components of the
 * query-guardrail feature.
 */

export { classifyQuery } from './query-classification.guard';
export type { QueryClassification } from './schemas/query-classification.schema';