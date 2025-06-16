import { Agent } from '@openai/agents';

/**
 * Specialized Biomedical Translation Agent
 * 
 * This agent is specifically designed to translate biomedical terms from various languages
 * to English for use with PubTator3 API, which only accepts English terms.
 */
export const biomedicalTranslatorAgent = new Agent({
  name: 'Biomedical Translator',
  model: 'gpt-4.1-nano', // Fast and cost-effective for translation
  instructions: `You are a specialized biomedical translator. Your ONLY job is to translate biomedical terms to English.

CRITICAL RULES:
1. ONLY translate biomedical terms (plants, diseases, chemicals, symptoms, etc.)
2. Use COMMON ENGLISH NAMES, not Latin scientific names
3. Return ONLY the English translation, nothing else
4. If multiple terms, separate with commas

TRANSLATION EXAMPLES:
Portuguese → English:
- "hortelã pimenta" → "peppermint"
- "dor de cabeça" → "headache"
- "lavanda" → "lavender"
- "melaleuca" → "tea tree oil"
- "ansiedade" → "anxiety"
- "depressão" → "depression"

Spanish → English:
- "manzanilla" → "chamomile"
- "dolor de cabeza" → "headache"
- "ansiedad" → "anxiety"
- "aceite de árbol de té" → "tea tree oil"

French → English:
- "lavande" → "lavender"
- "menthe" → "mint"
- "anxiété" → "anxiety"
- "mal de tête" → "headache"

German → English:
- "pfefferminze" → "peppermint"
- "lavendel" → "lavender"
- "kopfschmerzen" → "headache"

Italian → English:
- "menta piperita" → "peppermint"
- "lavanda" → "lavender"
- "mal di testa" → "headache"

IMPORTANT:
- Use common English names that PubTator3 API will recognize
- Do NOT use Latin names like "Mentha piperita" - use "peppermint"
- Do NOT use scientific names like "Lavandula angustifolia" - use "lavender"
- Keep translations simple and commonly used

RESPONSE FORMAT:
Input: "hortelã pimenta e dor de cabeça"
Output: "peppermint, headache"

Input: "lavanda para ansiedade"
Output: "lavender, anxiety"

ONLY return the English translations, nothing else.`,
  
  modelSettings: {
    temperature: 0.1, // Very focused for consistent translations
    maxTokens: 100,   // Short responses only
    toolChoice: 'none' // No tools needed for translation
  }
});

/**
 * Create the translator tool for use in other agents
 */
export const biomedicalTranslatorTool = biomedicalTranslatorAgent.asTool({
  toolName: 'translate_biomedical_terms',
  toolDescription: 'Translate biomedical terms from any language to English for use with PubTator3 API. Input non-English biomedical terms, get English translations.'
});

/**
 * Test function to verify translator works correctly
 */
export async function testBiomedicalTranslator() {
  const { run } = await import('@openai/agents');
  
  const testCases = [
    'hortelã pimenta e dor de cabeça',
    'lavanda para ansiedade',
    'manzanilla y dolor de cabeza',
    'lavande et anxiété',
    'melaleuca oil'
  ];

  console.log('🧪 Testing Biomedical Translator Agent...\n');

  for (const testCase of testCases) {
    try {
      const result = await run(biomedicalTranslatorAgent, testCase);
      console.log(`Input:  "${testCase}"`);
      console.log(`Output: "${result.finalOutput}"`);
      console.log('---');
    } catch (error) {
      console.error(`Error translating "${testCase}":`, error);
    }
  }
}

// Export for use in main agent
export default biomedicalTranslatorAgent;
