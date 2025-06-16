// src/core/orchestrator.ts

import { run, withTrace } from '@openai/agents';
import type { MCPServerStdio, RunResult } from '@openai/agents';
import type { OrchestrationMemory } from './session-memory';
import { classifyQuery } from '../features/query-guardrail';
import { biomedicalTranslatorAgent } from '../features/translation';
import { createTriageAgent } from '../features/biomedical-research';

/**
 * Executes a single, standard, non-judged research pass.
 *
 * This function is the core subroutine for the research process. It is called
 * by higher-level orchestrators, such as the judge loop.
 *
 * @param userQuery The raw query from the user.
 * @param memory The current session memory.
 * @param mcpServer The shared MCP server instance.
 * @returns An object containing the final result and the updated memory.
 */
export async function executeResearchSubroutine( // <-- RENAMED HERE
  userQuery: string,
  memory: OrchestrationMemory,
  mcpServer: MCPServerStdio,
): Promise<{ result: string; memory: OrchestrationMemory; runResult: RunResult<any, any> }> {
  return withTrace('Unified Research Subroutine', async () => { // <-- Trace name updated
    // 1. GUARDRAIL: Classify the input query.
    console.log('🛡️  Running Guardrail...');
    const classification = await classifyQuery(userQuery);
    console.log(`🎯 Classification: ${classification.queryType} | Language: ${classification.detectedLanguage}`);

    // 2. TRANSLATE: If needed, translate the query to English.
    let finalQuery = userQuery;
    if (classification.needsTranslation) {
      console.log('🌍 Translating to English...');
      const translationResult = await run(biomedicalTranslatorAgent, userQuery);
      finalQuery = translationResult.finalOutput || userQuery;
      console.log(`🗣️  Translated Query: "${finalQuery}"`);
    }

    // 3. ROUTE & EXECUTE: Use the Triage agent to handoff to the correct specialist.
    console.log('🔄 Routing to specialist...');
    const triageAgent = createTriageAgent(mcpServer);
    const researchResult = await run(triageAgent, finalQuery);

    // 4. UPDATE MEMORY: Persist the results of this interaction.
    memory.totalInteractions++;
    memory.conversationHistory = researchResult.history;
    memory.lastRunState = researchResult.state?.toString(); // Save resumable state

    const finalOutput = researchResult.finalOutput || 'No results found.';
    return { result: finalOutput, memory, runResult: researchResult };
  });
}