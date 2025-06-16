// src/core/cli.ts

import { createInterface } from 'node:readline/promises';
import * as path from 'node:path';
import { MCPServerStdio, stream } from '@openai/agents';
import {
  loadOrchestrationMemory,
  saveOrchestrationMemory,
  clearOrchestrationMemory,
  type OrchestrationMemory,
} from './session-memory';
import { runJudgedResearch } from '../features/quality-judge';

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
        // For standard queries, we will use stream() for a real-time experience.
        console.log('\n🔬 Research in Progress...');
        const runStream = await stream({
            agent: createTriageAgent(mcpServer), // We need to create the agent to stream it
            input,
            runState: sessionMemory.lastRunState, // Use last state to potentially resume
        });

        let finalOutput = '';
        for await (const event of runStream.events) {
            if (event.type === 'handoff_start') {
                process.stdout.write(`\n[Routing to ${event.agentName}...]`);
            }
            if (event.type === 'tool_call') {
                process.stdout.write(`\n[Calling tool: ${event.toolName}]`);
            }
            if (event.type === 'text_delta') {
                process.stdout.write(event.delta);
            }
            if (event.type === 'final_output') {
                finalOutput = event.output;
            }
        }
        
        // Update memory after the stream is complete
        sessionMemory.totalInteractions++;
        sessionMemory.conversationHistory = await runStream.history();
        sessionMemory.lastRunState = (await runStream.finalResult()).state.toString();
        console.log('\n\n✅ Research Complete.');
      }

      await saveOrchestrationMemory(sessionMemory);
    }
  } catch (error) {
    console.error('\n❌ An unexpected error occurred:', error);
  } finally {
    rl.close();
    if (mcpServer.state !== 'closed') {
      await mcpServer.close();
      console.log('\n🔌 Shared MCP server connection closed.');
    }
  }
}