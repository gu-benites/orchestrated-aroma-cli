// src/features/translation/agent/biomedical-translator.agent.ts

import { Agent } from '@openai/agents';
import { biomedicalTranslatorAgentConfig } from '../prompts/biomedical-translator.instructions';

/**
 * A specialized agent responsible for translating biomedical terms into common English.
 *
 * This agent is used by the core orchestrator to normalize user queries from
 * various languages into a standardized English format that the research
 * agents and the PubTator3 API can understand.
 */
export const biomedicalTranslatorAgent = new Agent(
  biomedicalTranslatorAgentConfig,
);