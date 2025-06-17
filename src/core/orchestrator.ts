// src/core/orchestrator.ts

import { run, withTrace } from '@openai/agents';
import type { MCPServerStdio, RunResult } from '@openai/agents';
import type { OrchestrationMemory } from './session-memory';
import { classifyQuery } from '../features/query-guardrail';
import { biomedicalTranslatorAgent } from '../features/translation';
import { createTriageAgent, createBiomedicalSearchAgent, createPMIDDetailsAgent } from '../features/biomedical-research';

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

    // 3. ROUTE VIA TRIAGE AGENT
    const langPrefix = `UserLanguage: ${classification.detectedLanguage}\n`;
    
    console.log('🔄 Routing via Front Desk Agent...');
    const triageAgent = createTriageAgent(mcpServer);

    // First pass: let the triage agent greet and possibly request a specialist.
    const triageFirst = await run(triageAgent, `${langPrefix}${finalQuery}`);
    let triageOutput = triageFirst.finalOutput || '';

    // If the triage agent requests a specialist, handle it.
    if (triageOutput.startsWith('SPECIALIST_REQUEST:')) {
      const specialistQuery = triageOutput.replace('SPECIALIST_REQUEST:', '').trim();

      // Decide which specialist to call.
      const pmidPattern = /\b\d{6,8}\b/; // Simple PMID heuristic
      const specialistAgent = pmidPattern.test(specialistQuery)
        ? createPMIDDetailsAgent(mcpServer)
        : createBiomedicalSearchAgent(mcpServer);

      console.log('🔬 Consulting specialist...');
      const specialistRun = await run(specialistAgent, specialistQuery);
      const specialistFindings = specialistRun.finalOutput || 'No specialist findings.';

      // Second pass: feed the findings back to the triage agent for a user-friendly response.
      const triageSecond = await run(
        triageAgent,
        `${langPrefix}Here are the specialist findings:\n\n${specialistFindings}`,
      );

      triageOutput = triageSecond.finalOutput || triageOutput;
      // Merge histories for memory persistence.
      triageFirst.history.push(...specialistRun.history, ...triageSecond.history);
    }

    // 4. UPDATE MEMORY
    memory.totalInteractions++;
    memory.conversationHistory = triageFirst.history;

    const finalOutput = triageOutput || 'No results found.';
    return { result: finalOutput, memory, runResult: triageFirst };
  });
}