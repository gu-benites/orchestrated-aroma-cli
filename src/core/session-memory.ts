// src/core/session-memory.ts

import * as fs from 'node:fs/promises';

const ORCHESTRATION_MEMORY_FILE = 'orchestrated-research-memory.json';

/**
 * Defines the structure of the session memory object.
 */
export interface OrchestrationMemory {
  conversationId: string;
  sessionStarted: string;
  totalInteractions: number;
  conversationHistory: any[];
  // The exact, resumable state of the last agent run.
  lastRunState?: string;
}

/**
 * Loads the orchestration memory from disk.
 * If no memory file exists, it creates a new one.
 * @returns A promise resolving to the OrchestrationMemory object.
 */
export async function loadOrchestrationMemory(): Promise<OrchestrationMemory> {
  try {
    const data = await fs.readFile(ORCHESTRATION_MEMORY_FILE, 'utf-8');
    const memory: OrchestrationMemory = JSON.parse(data);
    console.log(`📚 Session loaded: ${memory.conversationId}`);
    return memory;
  } catch {
    const newMemory: OrchestrationMemory = {
      conversationId: `session_${Date.now()}`,
      sessionStarted: new Date().toISOString(),
      totalInteractions: 0,
      conversationHistory: [],
    };
    console.log(`🆕 New session created: ${newMemory.conversationId}`);
    return newMemory;
  }
}

/**
 * Saves the orchestration memory to disk.
 * @param memory The memory object to save.
 */
export async function saveOrchestrationMemory(memory: OrchestrationMemory): Promise<void> {
  try {
    await fs.writeFile(ORCHESTRATION_MEMORY_FILE, JSON.stringify(memory, null, 2));
  } catch (error) {
    console.error('❌ Failed to save session memory:', error);
  }
}

/**
 * Clears the session memory by deleting the memory file.
 */
export async function clearOrchestrationMemory(): Promise<void> {
  try {
    await fs.unlink(ORCHESTRATION_MEMORY_FILE);
    console.log('🗑️ Session memory cleared successfully.');
  } catch (error) {
    // It's okay if the file doesn't exist.
    if (error instanceof Error && 'code' in error && error.code !== 'ENOENT') {
      console.error('❌ Failed to clear session memory:', error);
    } else {
      console.log('🗑️ No session memory file to clear.');
    }
  }
}