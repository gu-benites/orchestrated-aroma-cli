import { runFixedOrchestratedCLI } from './orchestrated-research';

// Entry point for Research Orchestrator CLI
console.log('Research Orchestrator CLI initialized.');

// If this file is run directly, start the CLI
if (require.main === module) {
  runFixedOrchestratedCLI();
}
