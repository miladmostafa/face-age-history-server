import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { start } from './app.js';

export { buildApp, start } from './app.js';
export { loadConfig } from './config.js';
export { toHistoryItem, toHistoryDocument } from './history.js';
export { attach, createClient } from './helper/index.js';

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectRun()) {
  start().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
