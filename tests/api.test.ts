import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const apiKey = 'test-api-key';
const authHeaders = { 'x-api-key': apiKey };
const headers = { ...authHeaders, 'content-type': 'application/json' };

function payload(token: string, skinAge = 28) {
  return {
    analysis: {
      analyze_ref_token: token,
      skinAge,
      damagePercentage: 12.4,
      basCode: 'data:image/jpeg;base64,/9j/AAAA',
      problems: [{ key: 'pores', title: 'Pores', number: 22 }],
    },
    activeSelections: { skinType: 'combination' },
    productLists: [{ id: 1, title: 'Serum', image: 'https://cdn.example.com/serum.png' }],
    meta: { ts: 1_710_000_000_000, image: 'data:image/jpeg;base64,FACE' },
  };
}

describe('scan history API', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await buildApp({
      config: loadConfig({
        ...process.env,
        API_KEY: apiKey,
        DATA_ENCRYPTION_KEY: 'test-encryption-key-please-change',
        TOKEN_SECRET: 'test-token-secret-value',
        DEMO_ENABLED: 'false',
        STORE_IMAGES: 'false',
        RETENTION_DAYS: '30',
        MAX_SCANS_PER_USER: '2',
        RATE_LIMIT_MAX: '10000',
        LOG_LEVEL: 'silent',
        NODE_ENV: 'test',
      }),
      prisma,
    });
    await app.ready();
  });

  beforeEach(async () => {
    await prisma.scan.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers health without an API key', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('rejects missing and unknown API keys', async () => {
    const missing = await app.inject({ method: 'GET', url: '/api/scans?user=123' });
    expect(missing.statusCode).toBe(401);
    const bearer = await app.inject({
      method: 'GET',
      url: '/api/scans?user=123',
      headers: { authorization: 'Bearer wrong-key' },
    });
    expect(bearer.statusCode).toBe(401);
  });

  it('creates, dedupes, lists, and strips images', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/scans',
      headers,
      payload: { userId: '123', payload: payload('analyze_ref_abc123', 28) },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.created).toBe(true);
    expect(body.analyzeRefToken).toBe('analyze_ref_abc123');
    expect(body.payload.analysis.basCode).toBeUndefined();
    expect(body.payload.meta.image).toBeUndefined();
    expect(body.payload.analysis.skinAge).toBe(28);
    expect(body.payload.productLists[0].image).toBe('https://cdn.example.com/serum.png');

    const stored = await prisma.scan.findFirstOrThrow();
    expect(stored.payloadEncrypted.includes('analyze_ref_abc123')).toBe(false);
    expect(stored.payloadEncrypted.includes('skinAge')).toBe(false);
    expect(stored.payloadEncrypted.includes('data:image')).toBe(false);

    const updated = await app.inject({
      method: 'POST',
      url: '/api/scans',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      payload: { user: '123', payload: payload('analyze_ref_abc123', 27) },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().created).toBe(false);
    expect(updated.json().payload.analysis.skinAge).toBe(27);
    expect(await prisma.scan.count()).toBe(1);

    const list = await app.inject({ method: 'GET', url: '/api/scans?user=123', headers });
    expect(list.statusCode).toBe(200);
    expect(list.json().scans).toHaveLength(1);
    expect(list.json().scans[0].payload.analysis.skinAge).toBe(27);
  });

  it('rejects a payload without analyze_ref_token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/scans',
      headers,
      payload: { userId: '123', payload: { analysis: { skinAge: 30 }, activeSelections: {} } },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toMatch(/analyze_ref_token/);
  });

  it('deletes one scan, exports the rest, then erases the user', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/scans',
      headers,
      payload: { userId: '123', payload: payload('analyze_ref_one', 31) },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/scans',
      headers,
      payload: { userId: '123', payload: payload('analyze_ref_two', 29) },
    });
    const id = second.json().id as string;

    const byToken = await app.inject({
      method: 'DELETE',
      url: '/api/scans?user=123&token=analyze_ref_one',
      headers: authHeaders,
    });
    expect(byToken.statusCode).toBe(200);

    const exported = await app.inject({ method: 'GET', url: '/api/users/123/export', headers });
    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-disposition']).toContain('face-age-history-123.json');
    expect(exported.json().scans).toHaveLength(1);
    expect(JSON.stringify(exported.json())).not.toContain('data:image');

    const byId = await app.inject({ method: 'DELETE', url: `/api/scans/${id}`, headers: authHeaders });
    expect(byId.statusCode).toBe(200);

    const erased = await app.inject({ method: 'DELETE', url: '/api/users/123', headers: authHeaders });
    expect(erased.json()).toEqual({ userId: '123', deleted: 0 });

    await app.inject({
      method: 'POST',
      url: '/api/scans',
      headers,
      payload: { userId: '123', payload: payload('analyze_ref_one', 31) },
    });
    const gone = await app.inject({ method: 'DELETE', url: '/api/users/123', headers: authHeaders });
    expect(gone.json().deleted).toBe(1);
    const list = await app.inject({ method: 'GET', url: '/api/scans?user=123', headers });
    expect(list.json().scans).toEqual([]);
  });

  it('drops scans older than the retention window and past the per-user cap', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/scans',
      headers,
      payload: { userId: '123', payload: payload('analyze_ref_old', 40) },
    });
    await prisma.scan.updateMany({
      data: { createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) },
    });
    const afterRetention = await app.inject({ method: 'GET', url: '/api/scans?user=123', headers });
    expect(afterRetention.json().scans).toEqual([]);

    for (const token of ['analyze_ref_a', 'analyze_ref_b', 'analyze_ref_c']) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/scans',
        headers,
        payload: { userId: '123', payload: payload(token) },
      });
      expect(response.statusCode).toBe(201);
    }
    const list = await app.inject({ method: 'GET', url: '/api/scans?user=123', headers });
    const tokens = list.json().scans.map((scan: { analyzeRefToken: string }) => scan.analyzeRefToken);
    expect(tokens).toHaveLength(2);
    expect(tokens).not.toContain('analyze_ref_a');
  });

  it('publishes OpenAPI and a public home page', async () => {
    const spec = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(spec.statusCode).toBe(200);
    const document = spec.json();
    expect(document.openapi).toBe('3.0.3');
    expect(document.paths['/api/scans']).toBeTruthy();
    expect(document.paths['/api/tokens'].post).toBeTruthy();
    expect(document.paths['/api/users/{userId}'].delete).toBeTruthy();

    const demo = await app.inject({
      method: 'POST',
      url: '/demo/session',
      headers: { 'content-type': 'application/json' },
      payload: { userId: '123' },
    });
    expect(demo.statusCode).toBe(404);

    const home = await app.inject({ method: 'GET', url: '/' });
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain('Face Age scan history server');
    expect(home.body).toContain('https://panel.getfaceage.com/');
    expect(home.body).toContain('rel="icon"');

    const icon = await app.inject({ method: 'GET', url: '/favicon.ico' });
    expect(icon.statusCode).toBe(302);
    expect(icon.headers.location).toBe('https://static.getfaceage.com/logo.png');

    const helper = await app.inject({ method: 'GET', url: '/face-age-history.js' });
    expect(helper.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });
});
