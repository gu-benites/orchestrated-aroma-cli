// src/features/query-guardrail/prompts/language-detection.instructions.ts

import type { AgentConfiguration } from '@openai/agents';
import { LanguageDetectionResultSchema } from '../schemas/language-detection.schema';

export const languageDetectionAgentConfig: Partial<AgentConfiguration> = {
  name: 'Language Detection Agent',
  description: 'A specialized agent that detects the primary language of a given text.',
  model: 'gpt-4.1-nano', // Perfect for fast, cheap, and accurate classification.
  modelSettings: {
    temperature: 0.0,
    toolChoice: 'none',
  },
  // The outputType is linked directly to our Zod schema to enforce structured JSON output.
  outputType: LanguageDetectionResultSchema,
  instructions: `You are a language detection specialist. Your sole purpose is to analyze the provided text and identify its primary language.

Respond ONLY with a JSON object that conforms to the required schema.

For example:
- Input: "what studies are there about lavender and anxiety?" -> Output: {"language": "English", "isEnglish": true}
- Input: "estudios sobre lavanda y ansiedad" -> Output: {"language": "Spanish", "isEnglish": false}
- Input: "lavande et anxiété" -> Output: {"language": "French", "isEnglish": false}
`,
};