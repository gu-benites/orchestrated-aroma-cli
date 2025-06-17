// src/core/cli.ts

import { createInterface } from 'node:readline/promises';
import * as path from 'node:path';
import { MCPServerStdio, run, withTrace } from '@openai/agents';
import {
  loadOrchestrationMemory,
  saveOrchestrationMemory,
  clearOrchestrationMemory,
  type OrchestrationMemory,
} from './session-memory';
import { runJudgedResearch } from '../features/quality-judge';
import { createTriageAgent } from '../features/biomedical-research';
import { classifyQuery } from '../features/query-guardrail';
import { biomedicalTranslatorAgent } from '../features/translation';

/**
 * The main entry point for the interactive Command-Line Interface (CLI).
 */
export async function runCLI() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('🎭 Orchestrated Biomedical Research Agent v2.0');
  console.log('Commands: --judge [query], memory, clear, exit\n');

  let sessionMemory = await loadOrchestrationMemory();

  // Initialize a single, shared MCP server for the entire session.
  console.log('🔌 Initializing shared MCP server...');
  const mcpServer = new MCPServerStdio({
    name: 'PubTator3',
    fullCommand: `npx tsx ${path.join(__dirname, '../tools/pubtator-mcp-server.ts')}`,
  });

  try {
    await mcpServer.connect();
    console.log('✅ Shared MCP server ready!\n');

    while (true) {
      const input = await rl.question('> ');

      if (input.toLowerCase() === 'exit') break;
      if (input.toLowerCase() === 'clear') {
        await clearOrchestrationMemory();
        sessionMemory = await loadOrchestrationMemory();
        continue;
      }
      if (input.toLowerCase() === 'memory') {
        console.log(sessionMemory);
        continue;
      }

      if (input.toLowerCase().startsWith('--judge ')) {
        const query = input.substring(8).trim();
        const { result, memory } = await runJudgedResearch(query, sessionMemory, mcpServer);
        sessionMemory = memory;
        console.log('\n\n✅ Judged Research Result:\n', result);
      } else {
        // For standard queries, wrap the entire workflow in a single trace
        console.log('\n🔬 Research in Progress...');

        await withTrace('Biomedical Research Query', async () => {
          // 1. GUARDRAIL: Classify the input query.
          console.log('🛡️  Running Guardrail...');
          const classification = await classifyQuery(input);
          console.log(`🎯 Classification: ${classification.queryType} | Language: ${classification.detectedLanguage}`);

          // 2. TRANSLATE: If needed, translate the query to English.
          let finalQuery = input;
          if (classification.needsTranslation) {
            console.log('🌍 Translating to English...');
            const translationResult = await run(biomedicalTranslatorAgent, input);
            finalQuery = translationResult.finalOutput || input;
            console.log(`🗣️  Translated Query: "${finalQuery}"`);
          }

          // 3. ROUTE & EXECUTE: Use the Triage agent to handoff to the correct specialist.
          console.log('🔄 Routing to specialist...');
          const triageAgent = createTriageAgent(mcpServer);

          // Use the correct run function signature: run(agent, input)
          const researchResult = await run(triageAgent, finalQuery);

          // 4. UPDATE MEMORY: Persist the results of this interaction.
          sessionMemory.totalInteractions++;
          sessionMemory.conversationHistory = researchResult.history;
          if (researchResult.state) {
            sessionMemory.lastRunState = researchResult.state.toString();
          }

          const finalOutput = researchResult.finalOutput || 'No results found.';
          console.log('\n\n✅ Research Complete:\n', finalOutput);
        });
      }

      await saveOrchestrationMemory(sessionMemory);
    }
  } catch (error) {
    console.error('\n❌ An unexpected error occurred:', error);
  } finally {
    rl.close();
    try {
      await mcpServer.close();
      console.log('\n🔌 Shared MCP server connection closed.');
    } catch (error) {
      // Server might already be closed, ignore the error
    }
  }
}