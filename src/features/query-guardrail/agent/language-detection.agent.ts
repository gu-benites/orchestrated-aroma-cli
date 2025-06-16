// src/features/query-guardrail/agent/language-detection.agent.ts

import { Agent } from '@openai/agents';
import { languageDetectionAgentConfig } from '../prompts/language-detection.instructions';

/**
 * A specialized, lightweight agent responsible for detecting the language of a given text.
 * It is configured to return a structured JSON object for easy parsing.
 */
export const languageDetectionAgent = new Agent(languageDetectionAgentConfig);