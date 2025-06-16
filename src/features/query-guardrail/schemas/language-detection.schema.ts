// src/features/query-guardrail/schemas/language-detection.schema.ts

import { z } from 'zod';

/**
 * Defines the schema for the output of the Language Detection Agent.
 * This ensures we get a predictable, structured response for parsing.
 */
export const LanguageDetectionResultSchema = z.object({
  /** The detected primary language of the text (e.g., "English", "Spanish"). */
  language: z.string().describe('The detected language of the text.'),

  /** A simple boolean indicating if the detected language is English. */
  isEnglish: z
    .boolean()
    .describe('True if the language is English, otherwise false.'),
});

export type LanguageDetectionResult = z.infer<
  typeof LanguageDetectionResultSchema
>;