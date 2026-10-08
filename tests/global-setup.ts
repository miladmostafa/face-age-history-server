import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { databaseUrl, dbFile } from './env.ts';

export default function setup(): void {
  process.env.DATABASE_URL = databaseUrl;
  process.env.API_KEY = 'test-api-key';
  process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key-please-change';
  process.env.TOKEN_SECRET = 'test-token-secret-value';
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    rmSync(dbFile + suffix, { force: true });
  }
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    stdio: 'inherit',
    env: process.env,
  });
}
