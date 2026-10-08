import { createHmac } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import { renderDemoPage } from '../src/demo/page.js';
import { verifyUserToken } from '../src/user-token.js';

const apiKey = 'test-api-key';
const tokenSecret = 'test-token-secret-value';
const authHeaders = { 'x-api-key': apiKey };
const headers = { ...authHeaders, 'content-type': 'application/json' };

function payload(token: string, skinAge = 28) {
  return {
    analysis: {
      analyze_ref_token: token,
      skinAge,
      problems: [{ key: 'pores', title: 'Pores', number: 22 }],
    },
    activeSelections: { skinType: 'combination' },
    meta: { ts: 1_710_000_000_000 },
  };
}

function expiredToken(userId: string): string {
  const iat = Math.floor(Date.now() / 1000) - 120;
  const exp = iat + 60;
  const encoded = Buffer.from(JSON.stringify({ sub: userId, iat, exp }), 'utf8').toString('base64url');
  const signingInput = `v1.${encoded}`;
  const signature = createHmac('sha256', tokenSecret).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

describe('per-user tokens and the local demo', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;
  let config: AppConfig;

  beforeAll(async () => {
    prisma = new PrismaClient();
    config = loadConfig({
      ...process.env,
      API_KEY: apiKey,
      DATA_ENCRYPTION_KEY: 'test-encryption-key-please-change',
      TOKEN_SECRET: tokenSecret,
      DEMO_ENABLED: 'true',
      STORE_IMAGES: 'false',
      RETENTION_DAYS: '365',
      MAX_SCANS_PER_USER: '50',
      RATE_LIMIT_MAX: '10000',
      LOG_LEVEL: 'silent',
      NODE_ENV: 'test',
      FACEAGE_CLIENT_ID: '',
    });
    app = await buildApp({ config, prisma });
    await app.ready();
  });

  beforeEach(async () => {
    await prisma.scan.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps the API key and token secret out of the demo page', () => {
    const html = renderDemoPage(config);
    expect(html).not.toContain(apiKey);
    expect(html).not.toContain(tokenSecret);
    expect(html).not.toContain('apiKey');
    expect(html).toContain('accessToken');
    expect(html).toContain('"faceageId":""');
    expect(html).not.toContain('YOUR_API_KEY');
  });

  it('mints a demo session token and does not embed the master key', async () => {
    const home = await app.inject({ method: 'GET', url: '/' });
    expect(home.statusCode).toBe(200);
    expect(home.body).not.toContain(apiKey);
    expect(home.body).not.toContain(tokenSecret);

    const session = await app.inject({
      method: 'POST',
      url: '/demo/session',
      headers: { 'content-type': 'application/json' },
      payload: { userId: '123' },
    });
    expect(session.statusCode).toBe(200);
    const minted = session.json();
    expect(minted.userId).toBe('123');
    expect(minted.tokenType).toBe('Bearer');
    expect(session.body).not.toContain(apiKey);
    expect(verifyUserToken(minted.accessToken, tokenSecret)?.sub).toBe('123');

    const created = await app.inject({
      method: 'POST',
      url: '/api/scans',
      headers: { authorization: `Bearer ${minted.accessToken}`, 'content-type': 'application/json' },
      payload: { payload: payload('analyze_ref_demo') },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().userId).toBe('123');
  });

  it('lets the API key mint a token and keeps that token inside one user', async () => {
    const minted = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers,
      payload: { userId: 'user-a', ttlSeconds: 120 },
    });
    expect(minted.statusCode).toBe(200);
    const tokenA = minted.json().accessToken as string;
    const bearer = { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' };

    const created = await app.inject({
      method: 'POST',
      url: '/api/scans',
      headers: bearer,
      payload: { payload: payload('analyze_ref_a', 30) },
    });
    expect(created.statusCode).toBe(201);
    const scanId = created.json().id as string;

    const otherUser = await app.inject({
      method: 'POST',
      url: '/api/scans',
      headers,
      payload: { userId: 'user-b', payload: payload('analyze_ref_b', 40) },
    });
    const otherId = otherUser.json().id as string;

    const mismatch = await app.inject({
      method: 'POST',
      url: '/api/scans',
      headers: bearer,
      payload: { userId: 'user-b', payload: payload('analyze_ref_stolen', 1) },
    });
    expect(mismatch.statusCode).toBe(403);
    expect(await prisma.scan.count({ where: { analyzeRefToken: 'analyze_ref_stolen' } })).toBe(0);

    const listOther = await app.inject({
      method: 'GET',
      url: '/api/scans?user=user-b',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(listOther.statusCode).toBe(403);

    const ownList = await app.inject({
      method: 'GET',
      url: '/api/scans',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(ownList.statusCode).toBe(200);
    expect(ownList.json().userId).toBe('user-a');
    expect(ownList.json().scans).toHaveLength(1);

    const deleteOther = await app.inject({
      method: 'DELETE',
      url: `/api/scans/${otherId}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(deleteOther.statusCode).toBe(404);
    expect(await prisma.scan.findUnique({ where: { id: otherId } })).toBeTruthy();

    const deleteOwn = await app.inject({
      method: 'DELETE',
      url: `/api/scans/${scanId}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(deleteOwn.statusCode).toBe(200);

    const remint = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers: bearer,
      payload: { userId: 'user-b' },
    });
    expect(remint.statusCode).toBe(403);

    const asHeader = await app.inject({
      method: 'GET',
      url: '/api/scans',
      headers: { 'x-api-key': tokenA },
    });
    expect(asHeader.statusCode).toBe(401);
  });

  it('rejects an expired or tampered token and still requires a user id for the API key', async () => {
    const expired = await app.inject({
      method: 'GET',
      url: '/api/scans',
      headers: { authorization: `Bearer ${expiredToken('user-a')}` },
    });
    expect(expired.statusCode).toBe(401);

    const minted = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers,
      payload: { userId: 'user-a' },
    });
    const token = minted.json().accessToken as string;
    const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
    const broken = await app.inject({
      method: 'GET',
      url: '/api/scans',
      headers: { authorization: `Bearer ${tampered}` },
    });
    expect(broken.statusCode).toBe(401);

    const missingUser = await app.inject({ method: 'GET', url: '/api/scans', headers: authHeaders });
    expect(missingUser.statusCode).toBe(400);
  });

  it('exports and erases the token user through /api/users/me', async () => {
    const minted = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers,
      payload: { userId: 'user-a' },
    });
    const token = minted.json().accessToken as string;
    await app.inject({
      method: 'POST',
      url: '/api/scans',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { payload: payload('analyze_ref_me') },
    });
    await app.inject({
      method: 'POST',
      url: '/api/scans',
      headers,
      payload: { userId: 'user-b', payload: payload('analyze_ref_other') },
    });

    const exported = await app.inject({
      method: 'GET',
      url: '/api/users/me/export',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.json().userId).toBe('user-a');
    expect(exported.json().scans).toHaveLength(1);

    const masterMe = await app.inject({ method: 'DELETE', url: '/api/users/me', headers: authHeaders });
    expect(masterMe.statusCode).toBe(403);

    const erased = await app.inject({
      method: 'DELETE',
      url: '/api/users/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(erased.json()).toEqual({ userId: 'user-a', deleted: 1 });
    expect(await prisma.scan.count({ where: { externalUserId: 'user-b' } })).toBe(1);
  });

  it('publishes the token route in OpenAPI', async () => {
    const spec = await app.inject({ method: 'GET', url: '/openapi.json' });
    const document = spec.json();
    expect(document.paths['/api/tokens'].post).toBeTruthy();
    expect(document.paths['/api/users/me'].delete).toBeTruthy();
    expect(document.paths['/api/users/me/export'].get).toBeTruthy();
    expect(JSON.stringify(document.components.securitySchemes.apiKey.description)).toMatch(/browser/i);
  });
});
