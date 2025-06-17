// src/index.ts

import 'dotenv/config';
import { runCLI } from './core';

// If this file is executed directly, start the command-line interface.
if (require.main === module) {
  runCLI();
}