import os from 'node:os';
import path from 'node:path';

export const dbFile = path.join(os.tmpdir(), 'face-age-history-test.db');
export const databaseUrl = `file:${dbFile}`;
