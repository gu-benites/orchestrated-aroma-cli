// src/features/biomedical-research/index.ts

/**
 * This barrel file exports the public-facing components of the
 * biomedical-research feature.
 *
 * The primary export is the `createTriageAgent` function, which serves
 * as the single entry point into this agent swarm. The core orchestrator
 * does not need to know about the individual specialist agents; it only
* needs to interact with the Triage Agent.
 */

export { createTriageAgent } from './agent/triage.agent';
export { createBiomedicalSearchAgent } from './agent/biomedical-search.agent';
export { createPMIDDetailsAgent } from './agent/pmid-details.agent';