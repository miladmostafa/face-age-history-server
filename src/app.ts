import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { apiKeyAllowed } from './auth.js';
import { loadConfig, type AppConfig } from './config.js';
import { createPrismaClient, ensureDatabaseDirectory, purgeExpired } from './db.js';
import { renderDemoPage, renderHomePage } from './demo/page.js';
import { HttpError } from './http-error.js';
import { userIdSchema } from './schemas.js';
import { createScanService, type ScanService } from './scans.js';
import { mintUserToken, verifyUserToken } from './user-token.js';

export interface BuildAppOptions {
  config?: AppConfig;
  prisma?: PrismaClient;
}

type HistoryAuth = { mode: 'master' } | { mode: 'user'; userId: string };

const historyAuth = new WeakMap<FastifyRequest, HistoryAuth>();
const publicDir = path.resolve(process.cwd(), 'public');

function resolveAuth(request: FastifyRequest, config: AppConfig): HistoryAuth | null {
  const apiKeyHeader = request.headers['x-api-key'];
  if (typeof apiKeyHeader === 'string' && apiKeyHeader.trim()) {
    if (!apiKeyAllowed(apiKeyHeader.trim(), config.apiKeys)) return null;
    return { mode: 'master' };
  }
  if (Array.isArray(apiKeyHeader)) return null;
  const authorization = request.headers.authorization;
  if (typeof authorization !== 'string') return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization.trim());
  if (!match) return null;
  const presented = match[1] ?? '';
  if (apiKeyAllowed(presented, config.apiKeys)) return { mode: 'master' };
  const claims = verifyUserToken(presented, config.tokenSecret);
  if (!claims) return null;
  return { mode: 'user', userId: claims.sub };
}

function requireAuth(request: FastifyRequest): HistoryAuth {
  const auth = historyAuth.get(request);
  if (!auth) throw new HttpError(401, 'A server API key or a per-user access token is required');
  return auth;
}

function scopedUser(request: FastifyRequest, supplied: unknown): string {
  const auth = requireAuth(request);
  if (auth.mode === 'user') {
    if (supplied !== undefined && supplied !== null && supplied !== '') {
      const parsed = userIdSchema.safeParse(supplied);
      if (!parsed.success || parsed.data !== auth.userId) {
        throw new HttpError(403, 'This access token is limited to one user', 'forbidden');
      }
    }
    return auth.userId;
  }
  if (supplied === undefined || supplied === null || supplied === '') {
    throw new HttpError(400, 'userId is required when calling with the server API key');
  }
  return userIdSchema.parse(supplied);
}

function requireUserToken(request: FastifyRequest): string {
  const auth = requireAuth(request);
  if (auth.mode !== 'user') {
    throw new HttpError(
      403,
      'This route requires a per-user access token. Call /api/users/:userId with the server API key.',
      'forbidden',
    );
  }
  return auth.userId;
}

function readPublic(name: string): string | null {
  try {
    return readFileSync(path.join(publicDir, name), 'utf8');
  } catch {
    return null;
  }
}

const scanExample = {
  analysis: {
    analyze_ref_token: 'analyze_ref_abc123',
    skinAge: 28,
    damagePercentage: 12.4,
    problems: [{ key: 'pores', title: 'Pores', number: 22 }],
  },
  activeSelections: { skinType: 'combination' },
  meta: { ts: 1710000000000 },
};

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  ensureDatabaseDirectory(config.databaseUrl);
  const prisma = options.prisma ?? createPrismaClient();
  const scans: ScanService = createScanService(prisma, {
    encryptionKey: config.encryptionKey,
    retentionDays: config.retentionDays,
    maxScansPerUser: config.maxScansPerUser,
    maxPayloadBytes: config.maxPayloadBytes,
    storeImages: config.storeImages,
  });

  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ['req.headers.authorization', 'req.headers["x-api-key"]'],
    },
    bodyLimit: Math.max(config.maxPayloadBytes * 4, 1_048_576),
    trustProxy: false,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });
  await app.register(cors, {
    origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((origin) => origin.trim()),
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Api-Key'],
  });
  await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: '1 minute',
    allowList: (request) => request.url === '/health' || request.url.startsWith('/docs'),
  });
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Face Age Scan History Server',
        description:
          'Self-hosted REST API that stores face-age skin analysis results per user and returns them to the browser SDK for history and comparison. The server API key is for your store backend only. Browsers use a short-lived access token scoped to one user id. Payloads are encrypted at rest. Facial images are dropped unless STORE_IMAGES=true.',
        version: '1.0.0',
      },
      tags: [
        { name: 'tokens', description: 'Mint a short-lived access token for one store user' },
        { name: 'scans', description: 'Create, list, and delete skin analysis scans' },
        { name: 'users', description: 'Export or delete every scan for one store user' },
      ],
      components: {
        securitySchemes: {
          apiKey: {
            type: 'apiKey',
            in: 'header',
            name: 'X-Api-Key',
            description: 'Server-to-server API key. Do not send this from a browser.',
          },
          bearer: {
            type: 'http',
            scheme: 'bearer',
            description:
              'Server API key, or a short-lived per-user access token from POST /api/tokens. A user token may only read and write that user.',
          },
        },
      },
      security: [{ apiKey: [] }, { bearer: [] }],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.addHook('onRequest', async (request, reply) => {
    const url = request.url.split('?')[0] ?? request.url;
    if (!url.startsWith('/api/')) return;
    const auth = resolveAuth(request, config);
    if (!auth) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'A server API key or a per-user access token is required',
      });
    }
    historyAuth.set(request, auth);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: 'Request validation failed',
        details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }
    const statusCode =
      typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    if (statusCode >= 500) request.log.error(error);
    const message =
      statusCode >= 500
        ? 'Internal server error'
        : error instanceof Error
          ? error.message
          : 'Request failed';
    return reply.code(statusCode).send({
      error: statusCode === 404 ? 'not_found' : statusCode === 401 ? 'unauthorized' : 'invalid_request',
      message,
    });
  });

  app.get('/health', {
    schema: { hide: true },
    handler: async () => ({ status: 'ok' }),
  });

  app.get('/openapi.json', {
    schema: { hide: true },
    handler: async () => app.swagger(),
  });

  app.get('/', {
    schema: { hide: true },
    handler: async (_request, reply) => {
      const html = config.demoEnabled ? renderDemoPage(config) : renderHomePage();
      return reply.type('text/html; charset=utf-8').send(html);
    },
  });

  app.get('/face-age-history.js', {
    schema: { hide: true },
    handler: async (_request, reply) => {
      const source = readPublic('face-age-history.js');
      if (!source) {
        return reply.code(404).send('Run npm run build so public/face-age-history.js exists.');
      }
      return reply.type('text/javascript; charset=utf-8').send(source);
    },
  });

  app.get('/demo.js', {
    schema: { hide: true },
    handler: async (_request, reply) => {
      const source = readPublic('demo.js');
      if (!source) return reply.code(404).send('demo.js is missing');
      return reply.type('text/javascript; charset=utf-8').send(source);
    },
  });

  app.post('/demo/session', {
    schema: { hide: true },
    handler: async (request, reply) => {
      if (!config.demoEnabled) {
        return reply.code(404).send({ error: 'not_found', message: 'Not found' });
      }
      const body = request.body as { userId?: unknown };
      const userId = userIdSchema.parse(body?.userId);
      return mintUserToken(userId, config.tokenSecret, config.userTokenTtlSeconds);
    },
  });

  app.post('/api/tokens', {
    schema: {
      tags: ['tokens'],
      summary: 'Mint a short-lived access token for one user',
      description:
        'Server-to-server only. Your store backend calls this with the API key and the logged-in user id. Give the accessToken to the browser helper. The token cannot read or write any other user.',
      body: {
        type: 'object',
        required: ['userId'],
        additionalProperties: false,
        properties: {
          userId: { type: 'string', examples: ['123'] },
          ttlSeconds: { type: 'integer', minimum: 60, maximum: 86400 },
        },
      },
    },
    handler: async (request) => {
      const auth = requireAuth(request);
      if (auth.mode !== 'master') {
        throw new HttpError(403, 'Only the server API key can mint access tokens', 'forbidden');
      }
      const body = request.body as { userId?: unknown; ttlSeconds?: unknown };
      const userId = userIdSchema.parse(body?.userId);
      let ttl = config.userTokenTtlSeconds;
      if (body?.ttlSeconds !== undefined) {
        if (typeof body.ttlSeconds !== 'number' || !Number.isInteger(body.ttlSeconds) || body.ttlSeconds < 60 || body.ttlSeconds > 86_400) {
          throw new HttpError(400, 'ttlSeconds must be an integer between 60 and 86400');
        }
        ttl = body.ttlSeconds;
      }
      return mintUserToken(userId, config.tokenSecret, ttl);
    },
  });

  app.post('/api/scans', {
    schema: {
      tags: ['scans'],
      summary: 'Store one face-age advisor result',
      description:
        'Upserts by analyze_ref_token. With the server API key, userId is required and comes from your store session. With a per-user access token, the user id is the token subject; a different userId is rejected. Facial image fields are removed before storage.',
      body: {
        type: 'object',
        additionalProperties: true,
        properties: {
          userId: { type: 'string', examples: ['123'] },
          user: { type: 'string', description: 'Alias of userId' },
          payload: {
            type: 'object',
            description: 'History item passed to API.setHistoryData for one scan',
            examples: [scanExample],
          },
          analysis: { type: 'object' },
          activeSelections: { type: 'object' },
          meta: { type: 'object' },
        },
      },
      response: {
        201: { description: 'Scan created', type: 'object', additionalProperties: true },
        200: { description: 'Existing scan updated', type: 'object', additionalProperties: true },
      },
    },
    handler: async (request, reply) => {
      const body = request.body as { userId?: unknown; user?: unknown; payload?: unknown };
      const userId = scopedUser(request, body?.userId ?? body?.user);
      const payload = body?.payload === undefined ? body : body.payload;
      const record = await scans.create(userId, payload);
      return reply.code(record.created ? 201 : 200).send(record);
    },
  });

  app.get('/api/scans', {
    schema: {
      tags: ['scans'],
      summary: 'List scans for one user',
      description:
        'API key callers pass user. Access-token callers omit user; the server uses the token subject. A user query that does not match the token is rejected.',
      querystring: {
        type: 'object',
        properties: {
          user: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
    handler: async (request) => {
      const query = request.query as { user?: string; limit?: number; offset?: number };
      const userId = scopedUser(request, query.user);
      const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
      const offset = Math.max(query.offset ?? 0, 0);
      const items = await scans.list(userId, limit, offset);
      return { userId, scans: items };
    },
  });

  app.delete('/api/scans/:id', {
    schema: {
      tags: ['scans'],
      summary: 'Delete one scan by id',
      description: 'An access token can delete only a scan that belongs to that token user. Another user looks like a missing scan.',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    },
    handler: async (request) => {
      const { id } = request.params as { id: string };
      const auth = requireAuth(request);
      return scans.removeById(id, auth.mode === 'user' ? auth.userId : undefined);
    },
  });

  app.delete('/api/scans', {
    schema: {
      tags: ['scans'],
      summary: 'Delete one scan by analyze_ref_token',
      querystring: {
        type: 'object',
        required: ['token'],
        properties: { user: { type: 'string' }, token: { type: 'string' } },
      },
    },
    handler: async (request) => {
      const query = request.query as { user?: string; token?: string };
      const userId = scopedUser(request, query.user);
      if (!query.token) throw new HttpError(400, 'token query parameter is required');
      return scans.removeByToken(userId, query.token);
    },
  });

  app.get('/api/users/me/export', {
    schema: {
      tags: ['users'],
      summary: 'Export the signed-in user',
      description: 'Requires a per-user access token. The server API key uses GET /api/users/{userId}/export.',
    },
    handler: async (request, reply) => {
      const userId = requireUserToken(request);
      const exported = await scans.exportUser(userId);
      return reply.header('content-disposition', `attachment; filename="face-age-history-${userId}.json"`).send(exported);
    },
  });

  app.delete('/api/users/me', {
    schema: {
      tags: ['users'],
      summary: 'Delete every scan for the signed-in user',
      description: 'Requires a per-user access token. The server API key uses DELETE /api/users/{userId}.',
    },
    handler: async (request) => {
      const userId = requireUserToken(request);
      const deleted = await scans.deleteUser(userId);
      return { userId, deleted };
    },
  });

  app.get('/api/users/:userId/export', {
    schema: {
      tags: ['users'],
      summary: 'Export every stored scan for a user',
      params: { type: 'object', required: ['userId'], properties: { userId: { type: 'string' } } },
    },
    handler: async (request, reply) => {
      const params = request.params as { userId: string };
      const userId = scopedUser(request, params.userId);
      const exported = await scans.exportUser(userId);
      return reply.header('content-disposition', `attachment; filename="face-age-history-${userId}.json"`).send(exported);
    },
  });

  app.delete('/api/users/:userId', {
    schema: {
      tags: ['users'],
      summary: 'Delete every scan for a user',
      description: 'GDPR-style erase. Removes every payload stored for this store user id.',
      params: { type: 'object', required: ['userId'], properties: { userId: { type: 'string' } } },
    },
    handler: async (request) => {
      const params = request.params as { userId: string };
      const userId = scopedUser(request, params.userId);
      const deleted = await scans.deleteUser(userId);
      return { userId, deleted };
    },
  });

  const timer = setInterval(() => {
    purgeExpired(prisma, config.retentionDays).catch((error: unknown) => {
      app.log.error(error);
    });
  }, 60 * 60 * 1000);
  timer.unref?.();

  app.addHook('onClose', async () => {
    clearInterval(timer);
    await prisma.$disconnect();
  });

  app.addHook('onReady', async () => {
    const removed = await purgeExpired(prisma, config.retentionDays);
    if (removed > 0) app.log.info({ removed }, 'purged expired scans');
  });

  return app;
}

export async function start(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp({ config });
  const shutdown = async () => {
    await app.close();
  };
  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
  await app.listen({ port: config.port, host: config.host });
}
