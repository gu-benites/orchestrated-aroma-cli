// src/features/quality-judge/schemas/quality-evaluation.schema.ts

import { z } from 'zod';

/**
 * Defines the schema for the structured output of the Quality Judge Agent.
 * This ensures the evaluation is consistent and actionable.
 */
export const QualityEvaluationSchema = z.object({
  /** A definitive score for the research output's quality. */
  score: z
    .enum(['pass', 'needs_improvement', 'fail'])
    .describe(
      "The quality assessment score: 'pass' if it's a great answer, 'needs_improvement' if it's fixable, 'fail' if it's poor.",
    ),

  /** A concise, high-level summary of the reasoning for the score. */
  feedback: z
    .string()
    .describe('Specific, high-level feedback on scientific accuracy, clarity, and completeness.'),

  /** A list of specific, actionable suggestions for the research agent to improve its next attempt. */
  suggestions: z
    .array(z.string())
    .describe('A list of concrete suggestions for the research agent to generate a better response.'),
});

/**
 * The TypeScript type inferred from the Zod schema.
 */
export type QualityEvaluation = z.infer<typeof QualityEvaluationSchema>;