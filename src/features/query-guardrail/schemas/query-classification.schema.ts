// src/features/query-guardrail/schemas/query-classification.schema.ts

import { z } from 'zod';

/**
 * Defines the schema for the final output of the query classification guardrail process.
 * This provides strong type safety for the rest of the application.
 */
export const QueryClassificationSchema = z.object({
  /** The type of query detected. */
  queryType: z.enum([
    'pmid_details',
    'biomedical_search',
    'general_question',
  ]),

  /** An extracted PubMed ID, if found in the query. */
  extractedPMID: z.string().nullable(),

  /** Indicates if the query is in a language other than English. */
  needsTranslation: z.boolean(),

  /** The detected language of the query. */
  detectedLanguage: z.string(),

  /** A confidence score (0-1) for the overall classification. */
  confidence: z.number().min(0).max(1),
});

/**
 * The TypeScript type inferred from the Zod schema.
 * This will be used throughout the application to type classification objects.
 */
export type QueryClassification = z.infer<typeof QueryClassificationSchema>;