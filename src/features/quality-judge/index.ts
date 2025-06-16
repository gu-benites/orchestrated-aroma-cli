// src/features/quality-judge/index.ts

/**
 * This barrel file exports the public-facing components of the
 * quality-judge feature.
 *
 * The primary export is the `runJudgedResearch` function, which is the
 * meta-orchestrator for the iterative quality control loop.
 */

export { runJudgedResearch } from './judge.orchestrator';