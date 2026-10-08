import { defineConfig } from 'vitest/config';
import { databaseUrl } from './tests/env';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    globalSetup: './tests/global-setup.ts',
    env: {
      DATABASE_URL: databaseUrl,
      API_KEY: 'test-api-key',
      DATA_ENCRYPTION_KEY: 'test-encryption-key-please-change',
      DEMO_ENABLED: 'false',
      STORE_IMAGES: 'false',
      RETENTION_DAYS: '365',
      MAX_SCANS_PER_USER: '50',
      RATE_LIMIT_MAX: '10000',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
    },
  },
});
