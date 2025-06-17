// src/features/query-guardrail/query-classification.guard.ts

import { run } from '@openai/agents';
import type { QueryClassification } from './schemas/query-classification.schema';
import { languageDetectionAgent } from './agent/language-detection.agent';

/**
 * An efficient, HYBRID input guardrail for classifying user queries.
 * This function is now ASYNCHRONOUS.
 *
 * It performs two steps:
 * 1.  Fast, local regex matching for structured data like PMIDs.
 * 2.  A targeted LLM call to the LanguageDetectionAgent for accurate language analysis.
 *
 * @param userQuery The raw input query from the user.
 * @returns A Promise resolving to a QueryClassification object.
 */
export async function classifyQuery(
  userQuery: string,
): Promise<QueryClassification> {
  // Step 1: Perform fast, local checks first.
  const pmidMatch = userQuery.match(/\b(\d{7,9})\b/);
  const extractedPMID = pmidMatch?.[1] || null;

  let queryType: QueryClassification['queryType'] = 'biomedical_search';
  if (extractedPMID) {
    queryType = 'pmid_details';
  } else if (/\b(hello|hi|help|what can you|how are you)\b/i.test(userQuery)) {
    queryType = 'general_question';
  }

  // Step 2: Make a targeted, asynchronous call to the Language Detection agent.
  const langDetectionResult = await run(languageDetectionAgent, userQuery);
  const langResult = langDetectionResult.finalOutput;

  if (!langResult) {
    // Fallback in case the agent fails
    console.error('Language detection agent failed. Defaulting to English.');
    return {
      queryType,
      extractedPMID,
      needsTranslation: false,
      detectedLanguage: 'English',
      confidence: 0.5, // Low confidence due to failure
    };
  }

  // Step 3: Combine the results into the final classification object.
  return {
    queryType,
    extractedPMID,
    needsTranslation: !langResult.isEnglish,
    detectedLanguage: langResult.language,
    confidence: 0.95, // High confidence as we used an LLM for the hardest part.
  };
}