// src/features/translation/index.ts

import { biomedicalTranslatorAgent } from './agent/biomedical-translator.agent';

/**
 * This barrel file exports the public-facing components of the translation feature.
 *
 * The primary export is the `biomedicalTranslatorAgent`. This agent is used
 * directly by the core orchestrator to normalize user input before it enters
 * the main research swarm.
 */

// Export the agent for direct use by the orchestrator.
// The agent.asTool() export has been removed as it was not used in this architecture.
export { biomedicalTranslatorAgent };