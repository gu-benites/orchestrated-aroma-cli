// src/features/biomedical-research/agent/biomedical-search.agent.ts

import { Agent } from '@openai/agents';
import type { MCPServerStdio } from '@openai/agents';
import { biomedicalSearchAgentConfig } from '../prompts/biomedical-search.instructions';

/**
 * Creates a specialist agent for handling general biomedical research queries.
 *
 * This agent operates exclusively in English. It expects an English query and
 * uses a suite of tools to find relevant studies and provide a comprehensive
 * English-language answer.
 *
 * @param mcpServer - The running MCP server instance providing PubTator3 tools.
 * @returns A configured Agent instance.
 */
export function createBiomedicalSearchAgent(mcpServer: MCPServerStdio) {
  return new Agent({
    ...biomedicalSearchAgentConfig,
    name: 'Biomedical Search Specialist',
    description:
      'A specialist agent that performs general biomedical research to answer complex questions.',
    handoffDescription: 'I specialize in conducting comprehensive biomedical research using PubTator3 database. I can search for studies, analyze research papers, and provide evidence-based answers about diseases, treatments, chemicals, and genes.',
    mcpServers: [mcpServer],
    // This agent has no other tools. Its capabilities are defined by the MCP server.
    tools: [],
  });
}