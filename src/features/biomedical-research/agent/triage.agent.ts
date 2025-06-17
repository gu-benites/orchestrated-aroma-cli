// src/features/biomedical-research/agent/triage.agent.ts

import { Agent } from '@openai/agents';
import type { MCPServerStdio } from '@openai/agents';
import { triageAgentConfig } from '../prompts/triage.instructions';
import { createBiomedicalSearchAgent } from './biomedical-search.agent';
import { createPMIDDetailsAgent } from './pmid-details.agent';

/**
 * Creates the Front Desk Agent, which serves as the main point of contact for users
 * and coordinates with specialist agents when technical expertise is needed.
 *
 * This agent handles all user interactions, provides a friendly interface,
 * and consults specialists when technical knowledge is required.
 *
 * @param mcpServer - The running MCP server instance, which will be passed down to the specialist agents.
 * @returns A configured Front Desk Agent instance with access to specialists.
 */
export function createTriageAgent(mcpServer: MCPServerStdio) {
  // Instantiate the specialist agents that this agent can consult
  const pmidAgent = createPMIDDetailsAgent(mcpServer);
  const searchAgent = createBiomedicalSearchAgent(mcpServer);

  return new Agent({
    ...triageAgentConfig,
    name: 'Front Desk Agent',
    handoffDescription: 'I am the front desk agent. I provide a friendly interface and coordinate with specialists when technical expertise is needed.',
    mcpServers: [mcpServer],
    tools: [],
    handoffs: [pmidAgent, searchAgent],
  });
}