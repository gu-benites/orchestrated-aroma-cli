import { Agent, run, withTrace, MCPServerStdio, RunState } from '@openai/agents';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as dotenv from 'dotenv';
import { getAgentConfig, getConfigInfo } from './agent-instructions';
import { biomedicalTranslatorTool } from './biomedical-translator-agent';

// Load environment variables
dotenv.config({ path: '.env.local' });

interface SessionMemory {
  conversationId: string;
  history: any[];
  lastState?: string;
  researchContext: {
    entities: Record<string, any>;
    searches: string[];
    findings: string[];
  };
}

async function restoreAndContinueSession() {
  // Get agent configuration
  const agentConfig = getAgentConfig('default');

  console.log('🔄 Restoring PubMed Research Session...');
  console.log(getConfigInfo(agentConfig));

  // Load session memory
  const MEMORY_FILE = 'pubmed-session-memory.json';
  let sessionMemory: SessionMemory;

  try {
    const data = await fs.readFile(MEMORY_FILE, 'utf-8');
    sessionMemory = JSON.parse(data);
    console.log(`📚 Found session: ${sessionMemory.conversationId}`);
    console.log(`📊 Previous interactions: ${sessionMemory.history.length}`);
    console.log(`🔍 Searches performed: ${sessionMemory.researchContext.searches.length}`);
  } catch {
    console.log('❌ No previous session found. Please run the main agent first.');
    return;
  }

  // Create MCP server
  const mcpServer = new MCPServerStdio({
    name: 'PubTator3',
    fullCommand: `npx tsx ${path.join(__dirname, 'pubtator-mcp-server.ts')}`
  });

  try {
    await mcpServer.connect();
    console.log('✅ MCP server connected');

    // Create agent using centralized configuration
    const agent = new Agent({
      name: agentConfig.name,
      model: agentConfig.model,
      modelSettings: agentConfig.modelSettings,
      instructions: agentConfig.instructions,
      mcpServers: [mcpServer],
      tools: [biomedicalTranslatorTool], // Add translator as a tool
    });

    // Restore state if available
    let restoredState: RunState<any, any> | undefined;
    if (sessionMemory.lastState) {
      try {
        restoredState = await RunState.fromString(agent, sessionMemory.lastState);
        console.log('🔄 Previous state restored successfully');
      } catch (error) {
        console.log('⚠️  Could not restore previous state, starting fresh');
      }
    }

    // Continue with a new query using restored context
    await withTrace(
      'PubMed Session Restoration',
      async () => {
        console.log('\n🧠 Session Context:');
        if (sessionMemory.researchContext.searches.length > 0) {
          console.log('Recent searches:', sessionMemory.researchContext.searches.slice(-3));
        }
        if (sessionMemory.researchContext.findings.length > 0) {
          console.log('Recent findings:', sessionMemory.researchContext.findings.slice(-2));
        }

        // Example: Continue research based on previous context
        const contextualQuery = sessionMemory.researchContext.searches.length > 0 
          ? `Based on our previous research about ${sessionMemory.researchContext.searches.slice(-1)[0]}, what are the latest findings?`
          : 'What would you like to research?';

        console.log(`\n🔬 Continuing research: ${contextualQuery}`);

        // Use restored state if available, otherwise use history
        const input = restoredState || sessionMemory.history.concat([
          { role: 'user', content: contextualQuery }
        ]);

        const result = await run(agent, input);

        // Debug: Show all tool calls including translator
        console.log('\n[DEBUG] Tool calls made during this interaction:');
        for (const item of result.newItems) {
          if (item.type === 'tool_call_item') {
            console.log(`[DEBUG] 🔧 Tool Called: ${(item as any).name || 'unknown'}`);
            if ((item as any).name === 'translate_biomedical_terms') {
              console.log(`[DEBUG] 🌍 Translation Input: "${JSON.stringify((item as any).arguments)}"`);
            } else {
              const inputStr = JSON.stringify((item as any).arguments || {});
              const truncatedInput = inputStr.length > 100 ? inputStr.substring(0, 100) + '...' : inputStr;
              console.log(`[DEBUG] 📥 Tool Input: ${truncatedInput}`);
            }
          }
          if (item.type === 'tool_call_output_item') {
            if ((item as any).name === 'translate_biomedical_terms') {
              console.log(`[DEBUG] 🌍 Translation Output: "${(item as any).output}"`);
            } else {
              console.log(`[DEBUG] 📤 Tool Result: ${(item as any).name} returned data`);
            }
          }
        }

        console.log('\n📊 Continued Research Result:');
        console.log(result.finalOutput);

        // Update memory
        sessionMemory.history = result.history;
        sessionMemory.lastState = result.state.toString();
        sessionMemory.researchContext.findings.push(
          result.finalOutput?.substring(0, 200) + '...' || 'No output'
        );

        // Save updated memory
        await fs.writeFile(MEMORY_FILE, JSON.stringify(sessionMemory, null, 2));
        console.log('\n💾 Session memory updated');
      },
      {
        groupId: sessionMemory.conversationId,
        metadata: {
          sessionType: 'pubmed-research-restoration',
          restoredFromState: !!restoredState
        }
      }
    );

  } finally {
    await mcpServer.close();
    console.log('\n✅ Session restoration complete');
  }
}

// Run the restoration
restoreAndContinueSession().catch(console.error);
