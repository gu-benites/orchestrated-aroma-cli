// src/features/query-guardrail/query-classification.guard.ts

import { run, withTrace } from '@openai/agents';
import type { QueryClassification } from './schemas/query-classification.schema';
import { languageDetectionAgent } from './agent/language-detection.agent';

/**
 * Classifies the user's query to determine its type, language, and whether it needs translation.
 *
 * This function acts as a guardrail, performing initial routing logic before the main
 * research agents are invoked. It combines fast local checks (e.g., for PMIDs) with
 * more powerful but slower LLM-based checks (e.g., for language detection).
 *
 * @param userQuery The raw query from the user.
 * @returns A promise that resolves to a `QueryClassification` object.
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
    let langResult: { language: string; isEnglish: boolean };

    try {
      // finalOutput can be either an object (if outputType parsing succeeded) or a JSON string.
      langResult = typeof langDetectionResult.finalOutput === 'string'
        ? JSON.parse(langDetectionResult.finalOutput)
        : (langDetectionResult.finalOutput as any);
    } catch {
      // Fallback if parsing fails
      langResult = { language: 'English', isEnglish: true };
    }

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