// src/features/quality-judge/agent/quality-judge.agent.ts

import { Agent } from '@openai/agents';
import { qualityJudgeAgentConfig } from '../prompts/quality-judge.instructions';

/**
 * A specialized agent that evaluates the quality of research results.
 *
 * It takes a user query and a generated response, and returns a structured
 * evaluation object, enabling an iterative refinement loop.
 */
export const qualityJudgeAgent = new Agent(qualityJudgeAgentConfig);