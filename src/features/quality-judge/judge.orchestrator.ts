// src/features/quality-judge/judge.orchestrator.ts

import { run, withTrace } from '@openai/agents';
import type { MCPServerStdio } from '@openai/agents';
import type { OrchestrationMemory } from '../../core/session-memory';
import { executeResearchSubroutine } from '../../core/orchestrator';
import { createQualityJudgeAgent } from './agent/quality-judge.agent';

const MAX_ATTEMPTS = 3;

export async function executeJudgeSubroutine(
  userQuery: string,
  memory: OrchestrationMemory,
  mcpServer: MCPServerStdio,
) {
  return withTrace('Quality Judge Loop', async () => {
    let attempts = 0;
    let lastResult = '';
    let lastHistory: any[] = [];

    while (attempts < MAX_ATTEMPTS) {
      attempts++;
      console.log(`\n⚖️  Judge Loop Attempt ${attempts}/${MAX_ATTEMPTS}`);

      const { result, memory: updatedMemory, runResult } = await executeResearchSubroutine(
        userQuery,
        memory,
        mcpServer,
      );

      lastResult = result;
      lastHistory = runResult.history;

      const judgeAgent = createQualityJudgeAgent(mcpServer);
      const judgeInput = `User Query: \"${userQuery}\"\n\nFull Conversation History:\n${JSON.stringify(lastHistory, null, 2)}\n\nFinal Answer Provided:\n\"${lastResult}\"`;

      const judgeRun = await run(judgeAgent, judgeInput);
      const critique = judgeRun.finalOutput || '';

      console.log(`\n📝 Judge's Critique: ${critique}`);

      if (critique.startsWith('PASS')) {
        console.log('✅ Quality check passed.');
        break;
      } else {
        console.log('❌ Quality check failed. Retrying with feedback...');
        userQuery = `${userQuery}\n\n[Retry Feedback]: ${critique}`;
      }
    }

    if (attempts >= MAX_ATTEMPTS) {
      console.log('⚠️ Max attempts reached. Returning last result.');
    }

    return { result: lastResult, memory };
  });
}