import { z } from 'zod';
import { loadEnvFiles } from './env-file.js';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  DATABASE_URL: z.string().min(1).default('file:./data/history.db'),
  API_KEY: z.string().optional().default(''),
  API_KEYS: z.string().optional().default(''),
  DATA_ENCRYPTION_KEY: z.string().min(16, 'DATA_ENCRYPTION_KEY must be at least 16 characters'),
  RETENTION_DAYS: z.coerce.number().int().min(0).max(3650).default(365),
  MAX_SCANS_PER_USER: z.coerce.number().int().min(1).max(1000).default(50),
  MAX_PAYLOAD_BYTES: z.coerce.number().int().min(1024).max(2_000_000).default(200_000),
  STORE_IMAGES: z.enum(['true', 'false', '1', '0']).default('false'),
  CORS_ORIGIN: z.string().default('*'),
  DEMO_ENABLED: z.enum(['true', 'false', '1', '0']).optional(),
  FACEAGE_CLIENT_ID: z.string().optional().default(''),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  LOG_LEVEL: z.string().default('info'),
  NODE_ENV: z.string().optional().default('development'),
});

export interface AppConfig {
  port: number;
  host: string;
  databaseUrl: string;
  apiKeys: string[];
  encryptionKey: string;
  retentionDays: number;
  maxScansPerUser: number;
  maxPayloadBytes: number;
  storeImages: boolean;
  corsOrigin: string;
  demoEnabled: boolean;
  faceageClientId: string;
  rateLimitMax: number;
  logLevel: string;
  nodeEnv: string;
}

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (env === process.env) loadEnvFiles();
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid configuration: ${message}`);
  }

  const data = parsed.data;
  const apiKeys = [...data.API_KEY.split(','), ...data.API_KEYS.split(',')]
    .map((key) => key.trim())
    .filter((key) => key.length > 0);

  if (apiKeys.length === 0) {
    throw new Error('Invalid configuration: set API_KEY or API_KEYS');
  }
  for (const key of apiKeys) {
    if (key.length < 8) {
      throw new Error('Invalid configuration: each API key must be at least 8 characters');
    }
  }

  return {
    port: data.PORT,
    host: data.HOST,
    databaseUrl: data.DATABASE_URL,
    apiKeys,
    encryptionKey: data.DATA_ENCRYPTION_KEY,
    retentionDays: data.RETENTION_DAYS,
    maxScansPerUser: data.MAX_SCANS_PER_USER,
    maxPayloadBytes: data.MAX_PAYLOAD_BYTES,
    storeImages: flag(data.STORE_IMAGES, false),
    corsOrigin: data.CORS_ORIGIN,
    demoEnabled: flag(data.DEMO_ENABLED, data.NODE_ENV !== 'production'),
    faceageClientId: (data.FACEAGE_CLIENT_ID || '').trim(),
    rateLimitMax: data.RATE_LIMIT_MAX,
    logLevel: data.LOG_LEVEL,
    nodeEnv: data.NODE_ENV,
  };
}
