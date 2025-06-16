// src/features/biomedical-research/agent/triage.agent.ts

import { Agent } from '@openai/agents';
import type { MCPServerStdio } from '@openai/agents';
import { triageAgentConfig } from '../prompts/triage.instructions';
import { createBiomedicalSearchAgent } from './biomedical-search.agent';
import { createPMIDDetailsAgent } from './pmid-details.agent';

/**
 * Creates the Triage Agent, which acts as a router for the biomedical research swarm.
 *
 * This agent's sole responsibility is to analyze the user's query (which it
 * expects to be in English) and delegate the task to the appropriate
 * specialist agent via the `handoffs` mechanism.
 *
 * @param mcpServer - The running MCP server instance, which will be passed down to the specialist agents.
 * @returns A configured Triage Agent instance with handoff capabilities.
 */
export function createTriageAgent(mcpServer: MCPServerStdio) {
  // Instantiate the specialist agents that this triage agent can hand off to.
  const pmidAgent = createPMIDDetailsAgent(mcpServer);
  const searchAgent = createBiomedicalSearchAgent(mcpServer);

  return new Agent({
    ...triageAgentConfig,
    name: 'Biomedical Triage Agent',
    description:
      'A routing agent that analyzes biomedical queries and hands them off to the correct specialist.',
    // This agent has no tools of its own. Its only job is to handoff.
    mcpServers: [],
    tools: [],
    // The list of specialist agents this Triage Agent can delegate tasks to.
    handoffs: [pmidAgent, searchAgent],
  });
}