// src/features/quality-judge/judge.orchestrator.ts

import { run, withTrace } from '@openai/agents';
import type { MCPServerStdio } from '@openai/agents';
import type { OrchestrationMemory } from '../../core/session-memory';
import { executeResearchSubroutine } from '../../core/orchestrator'; // <-- IMPORT RENAMED
import { qualityJudgeAgent } from './agent/quality-judge.agent';

/**
 * Runs the biomedical research workflow with an LLM-as-a-Judge loop for quality control.
 *
 * This orchestrator repeatedly calls the main research workflow and has a Quality
 * Judge Agent evaluate the result. If the result is not satisfactory, it refines
 * the query with the judge's feedback and tries again.
 *
 * @param userQuery The initial query from the user.
 * @param memory The current session memory.
 * @param mcpServer The shared MCP server instance.
 * @param maxIterations The maximum number of refinement loops to attempt.
 * @returns An object containing the final result, updated memory, and number of iterations.
 */
export async function runJudgedResearch(
  userQuery: string,
  memory: OrchestrationMemory,
  mcpServer: MCPServerStdio,
  maxIterations: number = 2,
) {
  return withTrace('LLM-as-a-Judge Workflow', async () => {
    let latestResult: string = '';
    let currentQuery = userQuery;
    let iteration = 0;

    while (iteration < maxIterations) {
      console.log(`\n🔄 Judge Loop Iteration ${iteration + 1}/${maxIterations}...`);

      // 1. Run the standard research subroutine with the current query.
      const { result: researchResult } = await executeResearchSubroutine( // <-- CALL RENAMED
        currentQuery,
        memory,
        mcpServer,
      );
      latestResult = researchResult;

      // ... (rest of the function remains the same)
      const judgeEvaluationContext = `
        Original User Query: "${userQuery}"
        ---
        Research Agent's Final Output:
        ${researchResult}
        ---
        Please evaluate if this output fully and clearly answers the user's query based on your criteria.
      `;

      const evaluation = await run(qualityJudgeAgent, judgeEvaluationContext)
        .finalOutput;

      if (!evaluation) {
        console.error('❌ Judge agent failed to return an evaluation. Exiting loop.');
        break;
      }

      console.log(`⚖️ Judge Score: ${evaluation.score.toUpperCase()}`);
      console.log(`💭 Judge Feedback: ${evaluation.feedback}`);

      if (evaluation.score === 'pass') {
        console.log('✅ Judge approved result. Concluding workflow.');
        break;
      }

      iteration++;
      if (iteration >= maxIterations) {
        console.log('⚠️ Maximum iterations reached. Returning last generated result.');
        break;
      }

      console.log(' refining query with judge feedback...');
      currentQuery = `
        The original query was: "${userQuery}"

        This is a retry. Your previous attempt was not sufficient. A quality judge has provided the following feedback. You MUST address it in your new response.

        Judge's Feedback: "${evaluation.feedback}"
        Specific Suggestions:
        - ${evaluation.suggestions.join('\n- ')}

        Please generate a new, improved response that directly answers the original query and incorporates this feedback.
      `;
    }

    return { result: latestResult, memory, iterations: iteration + 1 };
  });
}
