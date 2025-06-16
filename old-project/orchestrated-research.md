import { Agent, run, withTrace, MCPServerStdio, RunState, RunResult } from '@openai/agents';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as dotenv from 'dotenv';
import { z } from 'zod';
import { getAgentConfig } from './agent-instructions';
import { biomedicalTranslatorAgent } from './biomedical-translator-agent';

// Load environment variables
dotenv.config({ path: '.env.local' });

// ============================================================================
// 🛡️ IMPROVED AGENT PATTERNS WITH PROPER GUARDRAILS & ROUTING
// ============================================================================

/**
 * Query Classification Schema for Input Guardrails
 */
const QueryClassificationSchema = z.object({
  queryType: z.enum(['biomedical_search', 'pmid_details', 'paper_analysis', 'general_question']),
  extractedPMID: z.string().nullable(),
  needsTranslation: z.boolean(),
  detectedLanguage: z.string(),
  confidence: z.number().min(0).max(1),
  biomedicalTerms: z.array(z.string()),
  reasoning: z.string()
});

/**
 * Input Guardrail Agent for Query Classification
 * Following OpenAI Agents JS patterns from input-guardrails.ts
 */
const queryClassificationGuard = new Agent({
  name: 'Query Classification Guard',
  model: 'gpt-4.1-nano',
  instructions: `You are a specialized input guardrail for biomedical research queries.

Analyze user input and classify:
1. Query type (biomedical_search, pmid_details, paper_analysis, general_question)
2. Extract PMIDs if present (8-digit numbers like 38155861)
3. Detect language and translation needs
4. Identify biomedical terms

PMID Detection:
- Look for patterns like "detalhes sobre 38155861", "more about PMID 12345"
- PMIDs are typically 8-digit numbers but can vary

Language Detection:
- Portuguese: "estudos sobre", "pesquisa", "detalhes sobre"
- Spanish: "estudios sobre", "investigación", "detalles sobre"
- English: "studies about", "research", "details about"

Respond with structured output only.`,
  outputType: QueryClassificationSchema,
});

/**
 * LLM as a Judge - Biomedical Quality Evaluation Schema
 * Following the official llm-as-a-judge.ts pattern
 */
const BiomedicalQualityEvaluation = z.object({
  feedback: z.string().describe('Specific feedback on scientific accuracy and completeness'),
  score: z.enum(['pass', 'needs_improvement', 'fail']).describe('Quality assessment score'),
  issues: z.array(z.string()).describe('List of specific issues found'),
  suggestions: z.array(z.string()).describe('Specific suggestions for improvement'),
  confidence: z.number().min(0).max(1).describe('Confidence in the evaluation')
});

/**
 * Biomedical Research Judge Agent
 * Evaluates the quality of biomedical research responses
 */
const biomedicalJudgeAgent = new Agent({
  name: 'Biomedical Research Judge',
  model: 'gpt-4.1-nano',
  instructions: `You are a specialized judge for biomedical research responses.

Your role is to evaluate the quality and accuracy of biomedical research results.

EVALUATION CRITERIA:
1. **Scientific Accuracy**: Are the claims scientifically sound?
2. **PMID Citations**: Are proper PMIDs included and relevant?
3. **Completeness**: Does the response fully address the query?
4. **Relevance**: Is the content relevant to the biomedical query?
5. **Clarity**: Is the information clearly presented?

SCORING GUIDELINES:
- **pass**: High quality, scientifically accurate, well-cited, complete
- **needs_improvement**: Good but has minor issues that can be fixed
- **fail**: Major scientific inaccuracies, missing citations, or irrelevant

IMPORTANT: Be strict but fair. Scientific accuracy is paramount.
Never give a pass on the first evaluation - always look for improvements.`,
  outputType: BiomedicalQualityEvaluation,
});

/**
 * Specialized Agents for Different Query Types
 * Following routing.ts pattern with handoffs
 */

// PMID Details Agent - specialized for paper details
function createPMIDDetailsAgent(mcpServer: MCPServerStdio) {
  const agentConfig = getAgentConfig();
  return new Agent({
    name: 'PMID Details Specialist',
    model: agentConfig.model,
    modelSettings: agentConfig.modelSettings,
    instructions: `${agentConfig.instructions}

SPECIALIZED FOR PMID DETAILS:
- You MUST use get_paper_text tool first for any PMID request
- Provide comprehensive paper details: title, authors, abstract, key findings
- If get_paper_text fails, use search_pubtator as fallback
- Always include PMID in your response`,
    mcpServers: [mcpServer],
  });
}

// Biomedical Search Agent - specialized for general research
function createBiomedicalSearchAgent(mcpServer: MCPServerStdio) {
  const agentConfig = getAgentConfig();
  return new Agent({
    name: 'Biomedical Search Specialist',
    model: agentConfig.model,
    modelSettings: agentConfig.modelSettings,
    instructions: `${agentConfig.instructions}

SPECIALIZED FOR BIOMEDICAL SEARCH:
- Use search_pubtator for finding relevant studies
- Use find_entity to identify biomedical entities first
- Provide multiple relevant PMIDs with citations
- Focus on scientific accuracy and relevance`,
    mcpServers: [mcpServer],
  });
}

// Triage Agent - routes to appropriate specialist
function createTriageAgent(pmidAgent: Agent<any, any>, searchAgent: Agent<any, any>) {
  return new Agent({
    name: 'Biomedical Triage Agent',
    model: 'gpt-4.1-nano',
    instructions: `You are a triage agent for biomedical research queries.

Route queries to the appropriate specialist:
- If query contains PMID numbers (like "38155861") → handoff to PMID Details Specialist
- For general biomedical research → handoff to Biomedical Search Specialist

Always handoff immediately - do not attempt to answer yourself.`,
    handoffs: [pmidAgent, searchAgent],
  });
}

/**
 * Query Classification Result Interface
 */
interface QueryClassification {
  queryType: 'biomedical_search' | 'pmid_details' | 'paper_analysis' | 'general_question';
  isEnglish: boolean;
  needsTranslation: boolean;
  detectedLanguage: string;
  confidence: number;
  extractedPMID: string | null;
  biomedicalTerms: string[];
  reasoning: string;
}

/**
 * Input Guardrail for Query Classification
 * Analyzes query without using a separate agent (more efficient)
 */
function classifyQueryWithInputGuardrail(userQuery: string, sessionMemory: OrchestrationMemory): QueryClassification {
  // PMID Detection
  const pmidMatch = userQuery.match(/\b(\d{7,9})\b/);
  const extractedPMID = pmidMatch?.[1] || null;

  // Language Detection Patterns
  const portuguesePatterns = /\b(estudos?|pesquisa|detalhes?|sobre|óleo|ansiedade|capim|limão|lavanda)\b/i;
  const spanishPatterns = /\b(estudios?|investigación|detalles?|aceite|ansiedad|manzanilla|dolor)\b/i;
  const hasNonEnglishChars = /[áàâãéêíóôõúçñü]/i.test(userQuery);

  const hasPortuguese = portuguesePatterns.test(userQuery);
  const hasSpanish = spanishPatterns.test(userQuery);
  const isEnglish = !hasNonEnglishChars && !hasPortuguese && !hasSpanish;

  // Query Type Classification
  let queryType: QueryClassification['queryType'] = 'biomedical_search';
  let reasoning = 'General biomedical search query';

  if (extractedPMID) {
    queryType = 'pmid_details';
    reasoning = `PMID ${extractedPMID} detected - requesting paper details`;
  } else if (/\b(detalhes?|details?|more about|analyze|analysis)\b/i.test(userQuery)) {
    queryType = 'paper_analysis';
    reasoning = 'Request for detailed analysis or information';
  } else if (/\b(hello|hi|help|what can you|how are you)\b/i.test(userQuery)) {
    queryType = 'general_question';
    reasoning = 'General conversation or help request';
  }

  // Biomedical Terms Extraction
  const biomedicalTerms: string[] = [];
  const commonTerms = ['lavanda', 'lavender', 'peppermint', 'hortelã', 'cipreste', 'cypress', 'ansiedade', 'anxiety'];
  commonTerms.forEach(term => {
    if (userQuery.toLowerCase().includes(term.toLowerCase())) {
      biomedicalTerms.push(term);
    }
  });

  const detectedLanguage = hasPortuguese ? 'Portuguese' : hasSpanish ? 'Spanish' : 'English';
  const confidence = extractedPMID ? 0.95 : (hasPortuguese || hasSpanish) ? 0.9 : 0.8;

  console.log(`🎯 Input Guardrail Classification: ${queryType} | ${detectedLanguage} (confidence: ${Math.round(confidence * 100)}%)`);
  console.log(`🔍 Analysis: ${reasoning}`);
  if (extractedPMID) {
    console.log(`📄 PMID Detected: ${extractedPMID}`);
  }

  return {
    queryType,
    isEnglish,
    needsTranslation: !isEnglish,
    detectedLanguage,
    confidence,
    extractedPMID,
    biomedicalTerms,
    reasoning
  };
}



// ============================================================================
// 💾 MEMORY & PERSISTENCE INTERFACES
// ============================================================================

/**
 * Orchestration Memory Interface
 * Stores conversation history and research context (NO translation cache)
 */
interface OrchestrationMemory {
  conversationId: string;
  sessionStarted: string;
  totalInteractions: number;

  // Language detection history for analytics
  languageDetectionHistory: Array<{
    query: string;
    detectedLanguage: string;
    needsTranslation: boolean;
    confidence: number;
    timestamp: string;
  }>;

  // Research context
  researchContext: {
    entities: Record<string, any>;
    searches: string[];
    findings: string[];
    pmids: string[];
  };

  // Conversation history for context
  conversationHistory: any[];

  // Last run state for persistence
  lastRunState?: string;
  lastRunResult?: any;
}

/**
 * Memory file location
 */
const ORCHESTRATION_MEMORY_FILE = 'orchestrated-pubmed-memory.json';

/**
 * Load orchestration memory from disk
 */
async function loadOrchestrationMemory(): Promise<OrchestrationMemory> {
  try {
    const data = await fs.readFile(ORCHESTRATION_MEMORY_FILE, 'utf-8');
    const memory = JSON.parse(data);

    // Migration: Add missing fields for backward compatibility
    if (!memory.languageDetectionHistory) {
      memory.languageDetectionHistory = [];
      console.log('🔄 Migrated memory: Added languageDetectionHistory field');
    }

    // Remove old translationCache if it exists
    if (memory.translationCache) {
      delete memory.translationCache;
      console.log('🔄 Migrated memory: Removed translationCache field');
    }

    console.log(`📚 Loaded session: ${memory.conversationId} (${memory.totalInteractions} interactions)`);
    return memory;
  } catch {
    const newMemory: OrchestrationMemory = {
      conversationId: `orchestrated_${Date.now()}`,
      sessionStarted: new Date().toISOString(),
      totalInteractions: 0,
      languageDetectionHistory: [],
      researchContext: {
        entities: {},
        searches: [],
        findings: [],
        pmids: []
      },
      conversationHistory: [],
    };
    console.log(`🆕 Created new session: ${newMemory.conversationId}`);
    return newMemory;
  }
}

/**
 * Save orchestration memory to disk
 */
async function saveOrchestrationMemory(memory: OrchestrationMemory): Promise<void> {
  try {
    await fs.writeFile(ORCHESTRATION_MEMORY_FILE, JSON.stringify(memory, null, 2));
    console.log(`💾 Memory saved | Interactions: ${memory.totalInteractions} | Language detections: ${memory.languageDetectionHistory?.length || 0}`);
  } catch (error) {
    console.error('❌ Failed to save memory:', error);
  }
}

/**
 * Orchestrated Biomedical Research using OpenAI Agents JS SDK
 *
 * This implementation demonstrates the correct pattern for multi-agent orchestration:
 * 1. Separate specialized agents (translator + research)
 * 2. Code-based orchestration (not LLM-based handoffs)
 * 3. Proper MCP server lifecycle management
 * 4. withTrace() for operation grouping
 * 5. Memory persistence with RunState & RunResult
 *
 * Based on OpenAI Agents JS documentation patterns from Context7
 */
export async function orchestratedBiomedicalResearch(
  userQuery: string,
  sessionMemory?: OrchestrationMemory,
  sharedMcpServer?: MCPServerStdio
): Promise<{ result: string; memory: OrchestrationMemory; runResult: RunResult<any, any> }> {
  // Load or use provided session memory
  let memory = sessionMemory || await loadOrchestrationMemory();

  // Get the same agent configuration that works in index.ts
  const agentConfig = getAgentConfig();

  // Use shared MCP server if provided, otherwise create new one
  let mcpServer: MCPServerStdio | null = null;
  let shouldCloseMcpServer = false;

  try {
    if (sharedMcpServer) {
      mcpServer = sharedMcpServer;
      console.log('🔌 Using shared MCP server connection...');
    } else {
      mcpServer = new MCPServerStdio({
        name: 'PubTator3',
        fullCommand: `npx tsx ${path.join(__dirname, 'pubtator-mcp-server.ts')}`
      });
      shouldCloseMcpServer = true;

      console.log('🔌 Connecting to new MCP server...');
      await mcpServer.connect();
      console.log('✅ MCP server connected successfully!');
    }

    const traceResult = await withTrace('Orchestrated Biomedical Research', async () => {
      console.log('\n🎭 Starting orchestrated biomedical research...');

      // Step 1: Efficient query classification using input guardrails
      const queryClassification = classifyQueryWithInputGuardrail(userQuery, memory);

      // Store classification in memory for analytics
      if (!memory.languageDetectionHistory) {
        memory.languageDetectionHistory = [];
      }
      memory.languageDetectionHistory.push({
        query: userQuery,
        detectedLanguage: queryClassification.detectedLanguage,
        needsTranslation: queryClassification.needsTranslation,
        confidence: queryClassification.confidence,
        timestamp: new Date().toISOString()
      });

      let translatedQuery = userQuery;
      let finalQuery = userQuery;

      // Step 2: Handle different query types with appropriate routing
      if (queryClassification.queryType === 'pmid_details' && queryClassification.extractedPMID) {
        console.log(`📄 Step 2: PMID details request detected - using get_paper_text for PMID ${queryClassification.extractedPMID}`);
        finalQuery = queryClassification.extractedPMID; // Use PMID directly
        translatedQuery = `details about PMID ${queryClassification.extractedPMID}`;
      } else if (queryClassification.needsTranslation) {
        console.log('🌍 Step 2: Translation needed - using translator agent...');

        // Provide context to translator for better results
        const contextualQuery = queryClassification.extractedPMID
          ? `Request for details about scientific paper PMID ${queryClassification.extractedPMID}`
          : userQuery;

        const translationResult = await run(biomedicalTranslatorAgent, contextualQuery);
        translatedQuery = translationResult.finalOutput || userQuery;
        finalQuery = translatedQuery;

        console.log(`🌍 Translation: "${userQuery}" → "${translatedQuery}"`);
      } else {
        console.log('🌍 Step 2: No translation needed - query is in English');
        finalQuery = userQuery;
      }
      
      // Step 3: Create research agent with MCP tools and query-specific instructions
      let researchInstructions = agentConfig.instructions;
      let researchQuery = '';

      if (queryClassification.queryType === 'pmid_details' && queryClassification.extractedPMID) {
        researchInstructions += `

SPECIAL INSTRUCTIONS FOR PMID DETAILS REQUEST:
- The user is asking for details about PMID: ${queryClassification.extractedPMID}
- Use get_paper_text tool with this PMID to retrieve full article content
- Provide comprehensive details including title, authors, abstract, key findings
- If get_paper_text fails, use search_pubtator to find basic information about this PMID`;

        researchQuery = `Get detailed information about PMID ${queryClassification.extractedPMID} using your MCP tools. Use get_paper_text first, then provide comprehensive details.`;
      } else {
        researchInstructions += `

IMPORTANT: You have been provided with translated English terms: "${translatedQuery}"
Use these EXACT terms in your MCP tool calls. Do not translate them again.`;

        researchQuery = `Research this biomedical query using your MCP tools: "${finalQuery}". Provide scientific results with PMIDs and citations.`;
      }

      const researchAgent = new Agent({
        name: agentConfig.name,
        model: agentConfig.model,
        modelSettings: agentConfig.modelSettings,
        instructions: `${researchInstructions}

CONTEXT FROM PREVIOUS INTERACTIONS:
- Session ID: ${memory.conversationId}
- Previous searches: ${memory.researchContext.searches.slice(-3).join(', ') || 'None'}
- Known entities: ${Object.keys(memory.researchContext.entities).slice(-5).join(', ') || 'None'}
- Query Type: ${queryClassification.queryType}`,
        mcpServers: mcpServer ? [mcpServer] : [], // MCP tools only
      });

      console.log(`🔬 Step 3: Conducting ${queryClassification.queryType} research...`);

      // Use conversation history for context
      const conversationInput = memory.conversationHistory.concat([
        { role: 'user', content: researchQuery }
      ]);

      const researchResult: RunResult<any, any> = await run(researchAgent, conversationInput);
      
      // Debug MCP tool calls (EXACT same format as index.ts)
      console.log('\n[DEBUG] MCP Tool calls made during research:');
      for (const item of researchResult.newItems) {
        if (item.type === 'tool_call_item') {
          const rawItem = (item as any).rawItem;
          const toolName = rawItem?.name || 'unknown';
          const args = rawItem?.arguments ? JSON.parse(rawItem.arguments) : {};
          
          console.log(`[DEBUG] 🔧 Tool Called: ${toolName}`);
          
          // Show the debug format the user wants to see
          console.log(`[DEBUG] Received message: {"method":"tools/call","params":{"name":"${toolName}","arguments":${JSON.stringify(args)}},"jsonrpc":"2.0","id":1}`);
          const inputStr = JSON.stringify(args);
          const truncatedInput = inputStr.length > 100 ? inputStr.substring(0, 100) + '...' : inputStr;
          console.log(`[DEBUG] 📥 Tool Input: ${truncatedInput}`);
        }
        
        if (item.type === 'tool_call_output_item') {
          const rawItem = (item as any).rawItem;
          const toolName = rawItem?.name || 'unknown';
          console.log(`[DEBUG] 📤 Tool Result: ${toolName} returned data`);
        }
      }
      
      // Update memory with new interaction
      memory.totalInteractions++;
      memory.conversationHistory = researchResult.history;
      memory.lastRunState = researchResult.state?.toString();
      memory.lastRunResult = {
        finalOutput: researchResult.finalOutput,
        timestamp: new Date().toISOString()
      };

      // Extract and store research context
      const searchTerm = queryClassification.queryType === 'pmid_details'
        ? `PMID Details: ${queryClassification.extractedPMID}`
        : translatedQuery;
      memory.researchContext.searches.push(searchTerm);

      if (researchResult.finalOutput) {
        memory.researchContext.findings.push(researchResult.finalOutput.substring(0, 200) + '...');

        // Extract PMIDs from the result
        const pmidMatches = researchResult.finalOutput.match(/PMID:\s*(\d+)/g);
        if (pmidMatches) {
          const newPmids = pmidMatches.map((match: string) => match.replace('PMID:', '').trim());
          memory.researchContext.pmids.push(...newPmids);
          // Keep only unique PMIDs
          memory.researchContext.pmids = Array.from(new Set(memory.researchContext.pmids));
        }
      }

      console.log('✅ Orchestrated biomedical research completed');
      console.log(`💾 Memory updated | Total interactions: ${memory.totalInteractions} | PMIDs collected: ${memory.researchContext.pmids.length}`);

      return {
        result: researchResult.finalOutput || 'No research results found.',
        memory,
        runResult: researchResult
      };
    });

    // Save memory to disk
    await saveOrchestrationMemory(traceResult.memory);

    return traceResult;

  } catch (error) {
    console.error('❌ Error in orchestrated biomedical research:', error);

    // Return error with memory preserved
    return {
      result: `Error occurred during research: ${error instanceof Error ? error.message : String(error)}`,
      memory: memory,
      runResult: {} as RunResult<any, any>
    };
  } finally {
    // Only close MCP server if we created it (not shared)
    if (shouldCloseMcpServer && mcpServer) {
      try {
        await mcpServer.close();
        console.log('🔌 MCP server connection closed');
      } catch (closeError) {
        console.error('Warning: Error closing MCP server:', closeError);
      }
    }
  }
}

/**
 * LLM as a Judge Implementation for Biomedical Research
 * Follows the official llm-as-a-judge.ts pattern with iterative improvement
 */
export async function orchestratedBiomedicalResearchWithJudge(
  userQuery: string,
  sessionMemory?: OrchestrationMemory,
  sharedMcpServer?: MCPServerStdio,
  maxIterations: number = 3
): Promise<{ result: string; memory: OrchestrationMemory; runResult: RunResult<any, any>; iterations: number }> {
  // Load or use provided session memory
  let memory = sessionMemory || await loadOrchestrationMemory();

  // Use shared MCP server if provided, otherwise create new one
  let mcpServer: MCPServerStdio | null = null;
  let shouldCloseMcpServer = false;

  try {
    if (sharedMcpServer) {
      mcpServer = sharedMcpServer;
      console.log('🔌 Using shared MCP server connection...');
    } else {
      mcpServer = new MCPServerStdio({
        name: 'PubTator3',
        fullCommand: `npx tsx ${path.join(__dirname, 'pubtator-mcp-server.ts')}`
      });
      shouldCloseMcpServer = true;

      console.log('🔌 Connecting to new MCP server...');
      await mcpServer.connect();
      console.log('✅ MCP server connected successfully!');
    }

    const traceResult = await withTrace('LLM as a Judge - Biomedical Research', async () => {
      console.log('\n🎭 Starting LLM as a Judge biomedical research...');

      // Step 1: Input Guardrail for Query Classification
      console.log('🛡️ Step 1: Running input guardrail for query classification...');

      const classificationResult = await run(queryClassificationGuard, `Classify this biomedical query: "${userQuery}"`);
      const classification = classificationResult.finalOutput;

      if (!classification) {
        throw new Error('Query classification failed');
      }

      console.log(`🎯 Classification: ${classification.queryType} | ${classification.detectedLanguage} (confidence: ${Math.round(classification.confidence * 100)}%)`);
      if (classification.extractedPMID) {
        console.log(`📄 PMID Detected: ${classification.extractedPMID}`);
      }

      // Store classification in memory
      if (!memory.languageDetectionHistory) {
        memory.languageDetectionHistory = [];
      }
      memory.languageDetectionHistory.push({
        query: userQuery,
        detectedLanguage: classification.detectedLanguage,
        needsTranslation: classification.needsTranslation,
        confidence: classification.confidence,
        timestamp: new Date().toISOString()
      });

      // Step 2: Translation if needed
      let finalQuery = userQuery;
      if (classification.needsTranslation) {
        console.log('🌍 Step 2: Translation needed - using translator agent...');
        const translationResult = await run(biomedicalTranslatorAgent, userQuery);
        finalQuery = translationResult.finalOutput || userQuery;
        console.log(`🌍 Translation: "${userQuery}" → "${finalQuery}"`);
      } else {
        console.log('🌍 Step 2: No translation needed - query is in English');
      }

      // Step 3: Create specialized agents
      console.log('🎭 Step 3: Creating specialized agents...');
      const pmidAgent = createPMIDDetailsAgent(mcpServer!);
      const searchAgent = createBiomedicalSearchAgent(mcpServer!);

      // Step 4: LLM as a Judge iterative improvement loop
      console.log('⚖️ Step 4: Starting LLM as a Judge evaluation loop...');

      let currentQuery = finalQuery;
      let latestResult: string | undefined = undefined;
      let iterations = 0;

      while (iterations < maxIterations) {
        console.log(`\n🔄 Iteration ${iterations + 1}/${maxIterations}`);

        // Generate research result
        let researchResult: RunResult<any, any>;
        if (classification.queryType === 'pmid_details') {
          console.log('📄 Generating PMID details...');
          researchResult = await run(pmidAgent, currentQuery);
        } else {
          console.log('🔬 Generating biomedical search results...');
          researchResult = await run(searchAgent, currentQuery);
        }

        if (!researchResult.finalOutput) {
          throw new Error('No research result generated');
        }

        latestResult = researchResult.finalOutput;
        console.log('📊 Research result generated');

        // Judge evaluation
        console.log('⚖️ Evaluating result quality...');
        const evaluationQuery = `Evaluate this biomedical research result:

Original Query: "${userQuery}"
Research Result: ${latestResult}

Please assess the quality, accuracy, and completeness of this research result.`;

        const judgeResult = await run(biomedicalJudgeAgent, evaluationQuery);
        const evaluation = judgeResult.finalOutput;

        if (!evaluation) {
          throw new Error('Judge evaluation failed');
        }

        console.log(`⚖️ Judge Score: ${evaluation.score} (confidence: ${Math.round(evaluation.confidence * 100)}%)`);
        console.log(`💭 Feedback: ${evaluation.feedback}`);

        if (evaluation.score === 'pass') {
          console.log('✅ Research result approved by judge, exiting loop.');

          // Update memory with final results
          memory.totalInteractions++;
          memory.conversationHistory = researchResult.history;
          memory.lastRunState = researchResult.state?.toString();
          memory.lastRunResult = {
            finalOutput: latestResult,
            timestamp: new Date().toISOString(),
            judgeEvaluation: evaluation
          };

          return {
            result: latestResult || 'Research completed successfully',
            memory,
            runResult: researchResult,
            iterations: iterations + 1
          };
        }

        console.log('🔄 Judge suggests improvements, refining query...');

        // Add feedback to improve next iteration
        currentQuery = `${finalQuery}

Previous attempt feedback: ${evaluation.feedback}
Issues to address: ${evaluation.issues.join(', ')}
Suggestions: ${evaluation.suggestions.join(', ')}

Please provide a better response addressing these concerns.`;

        iterations++;
      }

      // Max iterations reached
      console.log(`⚠️ Maximum iterations (${maxIterations}) reached. Using last result.`);

      // Update memory even if not perfect
      memory.totalInteractions++;
      memory.lastRunResult = {
        finalOutput: latestResult || 'No result generated',
        timestamp: new Date().toISOString(),
        maxIterationsReached: true
      };

      return {
        result: latestResult || 'Research completed but quality could not be optimized within iteration limit.',
        memory,
        runResult: {} as RunResult<any, any>,
        iterations
      };
    });

    // Save memory to disk
    await saveOrchestrationMemory(traceResult.memory);

    return traceResult;

  } catch (error) {
    console.error('❌ Error in LLM as a Judge biomedical research:', error);

    return {
      result: `Error occurred during research: ${error instanceof Error ? error.message : String(error)}`,
      memory: memory,
      runResult: {} as RunResult<any, any>,
      iterations: 0
    };
  } finally {
    // Only close MCP server if we created it (not shared)
    if (shouldCloseMcpServer && mcpServer) {
      try {
        await mcpServer.close();
        console.log('🔌 MCP server connection closed');
      } catch (closeError) {
        console.error('Warning: Error closing MCP server:', closeError);
      }
    }
  }
}

/**
 * Improved Orchestrated Research using OpenAI Agents JS Patterns
 * Implements proper routing, input/output guardrails, and handoffs
 */
export async function orchestratedBiomedicalResearchWithProperPatterns(
  userQuery: string,
  sessionMemory?: OrchestrationMemory,
  sharedMcpServer?: MCPServerStdio
): Promise<{ result: string; memory: OrchestrationMemory; runResult: RunResult<any, any> }> {
  // Load or use provided session memory
  let memory = sessionMemory || await loadOrchestrationMemory();

  // Use shared MCP server if provided, otherwise create new one
  let mcpServer: MCPServerStdio | null = null;
  let shouldCloseMcpServer = false;

  try {
    if (sharedMcpServer) {
      mcpServer = sharedMcpServer;
      console.log('🔌 Using shared MCP server connection...');
    } else {
      mcpServer = new MCPServerStdio({
        name: 'PubTator3',
        fullCommand: `npx tsx ${path.join(__dirname, 'pubtator-mcp-server.ts')}`
      });
      shouldCloseMcpServer = true;

      console.log('🔌 Connecting to new MCP server...');
      await mcpServer.connect();
      console.log('✅ MCP server connected successfully!');
    }

    const traceResult = await withTrace('Improved Orchestrated Biomedical Research', async () => {
      console.log('\n🎭 Starting improved orchestrated biomedical research...');

      // Step 1: Input Guardrail for Query Classification
      console.log('🛡️ Step 1: Running input guardrail for query classification...');

      const classificationResult = await run(queryClassificationGuard, `Classify this biomedical query: "${userQuery}"`);
      const classification = classificationResult.finalOutput;

      if (!classification) {
        throw new Error('Query classification failed');
      }

      console.log(`🎯 Classification: ${classification.queryType} | ${classification.detectedLanguage} (confidence: ${Math.round(classification.confidence * 100)}%)`);
      if (classification.extractedPMID) {
        console.log(`📄 PMID Detected: ${classification.extractedPMID}`);
      }

      // Store classification in memory
      if (!memory.languageDetectionHistory) {
        memory.languageDetectionHistory = [];
      }
      memory.languageDetectionHistory.push({
        query: userQuery,
        detectedLanguage: classification.detectedLanguage,
        needsTranslation: classification.needsTranslation,
        confidence: classification.confidence,
        timestamp: new Date().toISOString()
      });

      // Step 2: Translation if needed
      let finalQuery = userQuery;
      if (classification.needsTranslation) {
        console.log('🌍 Step 2: Translation needed - using translator agent...');
        const translationResult = await run(biomedicalTranslatorAgent, userQuery);
        finalQuery = translationResult.finalOutput || userQuery;
        console.log(`🌍 Translation: "${userQuery}" → "${finalQuery}"`);
      } else {
        console.log('🌍 Step 2: No translation needed - query is in English');
      }

      // Step 3: Create specialized agents and triage
      console.log('🎭 Step 3: Creating specialized agents and routing...');
      const pmidAgent = createPMIDDetailsAgent(mcpServer!);
      const searchAgent = createBiomedicalSearchAgent(mcpServer!);
      const triageAgent = createTriageAgent(pmidAgent, searchAgent);

      // Step 4: Route to appropriate agent using handoffs
      console.log(`🔄 Step 4: Routing ${classification.queryType} query to specialist...`);
      const researchResult: RunResult<any, any> = await run(triageAgent, finalQuery);

      // Update memory with research results
      memory.totalInteractions++;
      memory.conversationHistory = researchResult.history;
      memory.lastRunState = researchResult.state?.toString();
      memory.lastRunResult = {
        finalOutput: researchResult.finalOutput,
        timestamp: new Date().toISOString()
      };

      // Extract and store research context
      const searchTerm = classification.queryType === 'pmid_details'
        ? `PMID Details: ${classification.extractedPMID}`
        : finalQuery;
      memory.researchContext.searches.push(searchTerm);

      if (researchResult.finalOutput) {
        memory.researchContext.findings.push(researchResult.finalOutput.substring(0, 200) + '...');

        // Extract PMIDs from the result
        const pmidMatches = researchResult.finalOutput.match(/PMID:\s*(\d+)/g);
        if (pmidMatches) {
          const newPmids = pmidMatches.map((match: string) => match.replace('PMID:', '').trim());
          memory.researchContext.pmids.push(...newPmids);
          memory.researchContext.pmids = Array.from(new Set(memory.researchContext.pmids));
        }
      }

      console.log('✅ Improved orchestrated biomedical research completed');
      console.log(`💾 Memory updated | Total interactions: ${memory.totalInteractions} | PMIDs collected: ${memory.researchContext.pmids.length}`);

      return {
        result: researchResult.finalOutput || 'No research results found.',
        memory,
        runResult: researchResult
      };
    });

    // Save memory to disk
    await saveOrchestrationMemory(traceResult.memory);

    return traceResult;

  } catch (error) {
    console.error('❌ Error in improved orchestrated biomedical research:', error);

    return {
      result: `Error occurred during research: ${error instanceof Error ? error.message : String(error)}`,
      memory: memory,
      runResult: {} as RunResult<any, any>
    };
  } finally {
    // Only close MCP server if we created it (not shared)
    if (shouldCloseMcpServer && mcpServer) {
      try {
        await mcpServer.close();
        console.log('🔌 MCP server connection closed');
      } catch (closeError) {
        console.error('Warning: Error closing MCP server:', closeError);
      }
    }
  }
}

/**
 * Simple wrapper for backward compatibility
 * Returns just the result string like the original function
 */
export async function orchestratedBiomedicalResearchSimple(userQuery: string): Promise<string> {
  const { result } = await orchestratedBiomedicalResearch(userQuery);
  return result;
}

// ============================================================================
// 💾 MEMORY MANAGEMENT FUNCTIONS
// ============================================================================

/**
 * Display current session memory
 */
async function displayMemory(): Promise<void> {
  try {
    const memory = await loadOrchestrationMemory();
    console.log('\n📚 Current Session Memory:');
    console.log(`🆔 Session ID: ${memory.conversationId}`);
    console.log(`📅 Started: ${new Date(memory.sessionStarted).toLocaleString()}`);
    console.log(`🔢 Total Interactions: ${memory.totalInteractions}`);
    console.log(`🌍 Language Detections: ${memory.languageDetectionHistory?.length || 0}`);
    console.log(`🔍 Searches Performed: ${memory.researchContext.searches.length}`);
    console.log(`📄 PMIDs Collected: ${memory.researchContext.pmids.length}`);

    if (memory.languageDetectionHistory && memory.languageDetectionHistory.length > 0) {
      console.log('\n🌍 Recent Language Detections:');
      memory.languageDetectionHistory.slice(-5).forEach((detection, index) => {
        const confidence = Math.round(detection.confidence * 100);
        const status = detection.needsTranslation ? '🔄 Translated' : '✅ English';
        console.log(`  ${memory.languageDetectionHistory.length - 4 + index}. "${detection.query}" → ${detection.detectedLanguage} (${confidence}%) ${status}`);
      });
    }

    if (memory.researchContext.searches.length > 0) {
      console.log('\n🔍 Recent Searches:');
      memory.researchContext.searches.slice(-5).forEach((search, index) => {
        console.log(`  ${memory.researchContext.searches.length - 4 + index}. ${search}`);
      });
    }

    if (memory.researchContext.pmids.length > 0) {
      console.log('\n📄 Collected PMIDs:');
      memory.researchContext.pmids.slice(-10).forEach(pmid => {
        console.log(`  PMID: ${pmid}`);
      });
    }
  } catch (error) {
    console.error('❌ Error loading memory:', error);
  }
}

/**
 * Clear session memory
 */
async function clearMemory(): Promise<void> {
  try {
    await fs.unlink(ORCHESTRATION_MEMORY_FILE);
    console.log('🗑️ Session memory cleared successfully');
  } catch (error) {
    console.log('🗑️ No memory file to clear (starting fresh)');
  }
}

/**
 * Test function to compare all three approaches
 */
export async function testAllApproaches(query: string) {
  console.log('🧪 Testing all approaches with query:', query);

  console.log('\n📊 === APPROACH 1: Input Guardrails (Current) ===');
  const start1 = Date.now();
  try {
    const result1 = await orchestratedBiomedicalResearch(query);
    const time1 = Date.now() - start1;
    console.log(`⏱️ Time: ${time1}ms`);
    console.log(`📝 Result: ${result1.result.substring(0, 200)}...`);
  } catch (error) {
    console.log(`❌ Error: ${error}`);
  }

  console.log('\n🎭 === APPROACH 2: Routing + Handoffs ===');
  const start2 = Date.now();
  try {
    const result2 = await orchestratedBiomedicalResearchWithProperPatterns(query);
    const time2 = Date.now() - start2;
    console.log(`⏱️ Time: ${time2}ms`);
    console.log(`📝 Result: ${result2.result.substring(0, 200)}...`);
  } catch (error) {
    console.log(`❌ Error: ${error}`);
  }

  console.log('\n⚖️ === APPROACH 3: LLM as a Judge (Quality Focused) ===');
  const start3 = Date.now();
  try {
    const result3 = await orchestratedBiomedicalResearchWithJudge(query);
    const time3 = Date.now() - start3;
    console.log(`⏱️ Time: ${time3}ms`);
    console.log(`� Iterations: ${result3.iterations}`);
    console.log(`�📝 Result: ${result3.result.substring(0, 200)}...`);
  } catch (error) {
    console.log(`❌ Error: ${error}`);
  }
}

/**
 * Test function for backward compatibility
 */
export async function testBothApproaches(query: string) {
  return testAllApproaches(query);
}

/**
 * Interactive CLI for testing the orchestrated workflow with memory
 */
export async function runFixedOrchestratedCLI() {
  const { createInterface } = await import('node:readline/promises');

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('🎭 Orchestrated PubMed Research Agent with Multiple Patterns');
  console.log('Features: Input guardrails, routing, handoffs, session persistence');
  console.log('Commands: "memory" (view), "clear" (reset), "test [query]" (compare approaches), "exit" (quit)\n');

  // Load initial memory
  let sessionMemory = await loadOrchestrationMemory();

  // Create shared MCP server for the entire session
  let sharedMcpServer: MCPServerStdio | null = null;

  try {
    console.log('🔌 Initializing shared MCP server for session...');
    sharedMcpServer = new MCPServerStdio({
      name: 'PubTator3',
      fullCommand: `npx tsx ${path.join(__dirname, 'pubtator-mcp-server.ts')}`
    });
    await sharedMcpServer.connect();
    console.log('✅ Shared MCP server ready for session!\n');
  } catch (error) {
    console.error('❌ Failed to initialize shared MCP server:', error);
    console.log('Will create individual connections per query...\n');
  }

  try {
    while (true) {
      const query = await rl.question('What would you like to research? ');

      if (query.toLowerCase() === 'exit') {
        break;
      }

      if (query.toLowerCase() === 'memory') {
        await displayMemory();
        continue;
      }

      if (query.toLowerCase() === 'clear') {
        await clearMemory();
        sessionMemory = await loadOrchestrationMemory(); // Reload fresh memory
        continue;
      }

      if (query.toLowerCase().startsWith('test ')) {
        const testQuery = query.substring(5).trim();
        if (testQuery) {
          await testBothApproaches(testQuery);
        } else {
          console.log('Usage: test [your query here]');
        }
        continue;
      }

      if (query.trim()) {
        try {
          const { result, memory } = await orchestratedBiomedicalResearch(query, sessionMemory, sharedMcpServer || undefined);

          // Update session memory for next iteration
          sessionMemory = memory;

          console.log('\n📊 Research Result:');
          console.log(result);

          // Show memory stats
          console.log(`\n💾 Session Stats: ${memory.totalInteractions} interactions | ${memory.languageDetectionHistory?.length || 0} language detections | ${memory.researchContext.pmids.length} PMIDs collected`);

          console.log('\n' + '─'.repeat(80) + '\n');
        } catch (error) {
          console.error('❌ Error:', error);
        }
      }
    }
  } finally {
    rl.close();

    // Close shared MCP server
    if (sharedMcpServer) {
      try {
        await sharedMcpServer.close();
        console.log('🔌 Shared MCP server closed');
      } catch (error) {
        console.error('Warning: Error closing shared MCP server:', error);
      }
    }
  }
}
