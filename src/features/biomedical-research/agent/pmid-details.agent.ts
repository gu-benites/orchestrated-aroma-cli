// src/features/biomedical-research/agent/pmid-details.agent.ts

import { Agent } from '@openai/agents';
import type { MCPServerStdio } from '@openai/agents';
import { pmidDetailsAgentConfig } from '../prompts/pmid-details.instructions';

/**
 * Creates a specialist agent for retrieving detailed information for a specific PMID.
 *
 * This agent's workflow is highly focused and operates only in English: receive a
 * PMID, use the `get_paper_text` tool, and format the results.
 *
 * @param mcpServer - The running MCP server instance providing PubTator3 tools.
 * @returns A configured Agent instance.
 */
export function createPMIDDetailsAgent(mcpServer: MCPServerStdio) {
  return new Agent({
    ...pmidDetailsAgentConfig,
    name: 'PMID Details Specialist',
    handoffDescription: 'I specialize in retrieving detailed information for specific PubMed IDs (PMIDs). I can fetch full paper text, abstracts, and provide comprehensive summaries of individual research papers.',
    mcpServers: [mcpServer],
    tools: [],
  });
}