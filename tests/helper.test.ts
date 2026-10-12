import { describe, expect, it, vi } from 'vitest';
import { attach, createClient, type FaceAgeLike, type FetchLike, type HistoryClientOptions } from '../src/helper/index.js';

function mockFetch(handler: (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => unknown): FetchLike {
  return vi.fn(async (url, init) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => handler(url, init),
  }));
}

describe('browser helper client', () => {
  it('posts advisor data with a user token and restores every scan in one setHistoryData call', async () => {
    const saved: unknown[] = [];
    const fetchImpl = mockFetch((url, init) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(init.body ?? '{}') as { userId?: string; payload: unknown };
        expect(body.userId).toBeUndefined();
        expect(init.headers?.['x-api-key']).toBeUndefined();
        expect(init.headers?.authorization).toBe('Bearer user-token');
        saved.push(body.payload);
        return { id: 'scan-1', userId: '123', analyzeRefToken: 'analyze_ref_live', payload: body.payload };
      }
      return {
        userId: '123',
        scans: [
          {
            id: '1',
            userId: '123',
            analyzeRefToken: 'older',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            payload: {
              analysis: { analyze_ref_token: 'older', skinAge: 32 },
              activeSelections: {},
              meta: { ts: 1 },
            },
          },
          {
            id: '2',
            userId: '123',
            analyzeRefToken: 'newer',
            createdAt: '2026-02-01T00:00:00.000Z',
            updatedAt: '2026-02-01T00:00:00.000Z',
            payload: {
              analysis: { analyze_ref_token: 'newer', skinAge: 29 },
              activeSelections: {},
              meta: { ts: 2 },
            },
          },
        ],
      };
    });

    let advisorCallback: ((data: unknown) => void) | null = null;
    let historyData: unknown = null;
    const removed: Array<string | null | undefined> = [];
    const faceAge: FaceAgeLike = {
      w: {
        globals: {
          skinAnalyzeData: { analyze_ref_token: 'analyze_ref_live', skinAge: 29, damagePercentage: 11 },
          formData: { skinType: 'dry' },
        },
      },
      API: {
        getAdvisorData: (callback) => {
          advisorCallback = callback;
          return Promise.resolve();
        },
        setHistoryData: (data) => {
          historyData = data;
          return Promise.resolve(true);
        },
        removeHistoryItem: (token) => {
          removed.push(token);
          return Promise.resolve(true);
        },
      },
    };

    const result = await attach(faceAge, {
      baseUrl: 'http://history.local',
      accessToken: 'user-token',
      fetch: fetchImpl,
    });

    expect(result.restored).toBe(2);
    expect(faceAge.w?.globals?.imageSubmit).toMatch(/^data:image\/png/);
    expect(historyData).toMatchObject({
      latestRefId: 'newer',
      items: {
        older: { analysis: { skinAge: 32 } },
        newer: { analysis: { skinAge: 29 } },
      },
    });

    advisorCallback?.({
      analysis: [{ key: 'acne', title: 'Acne', number: 4 }],
      activeSelections: { skinType: 'dry' },
    });
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    const posted = saved[0] as { analysis: { analyze_ref_token: string; problems: unknown[]; skinAge: number } };
    expect(posted.analysis.analyze_ref_token).toBe('analyze_ref_live');
    expect(posted.analysis.skinAge).toBe(29);
    expect(posted.analysis.problems).toEqual([{ key: 'acne', title: 'Acne', number: 4 }]);

    await faceAge.API.removeHistoryItem('older');
    expect(removed).toEqual(['older']);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://history.local/api/scans?token=older',
      expect.objectContaining({
        method: 'DELETE',
        headers: { authorization: 'Bearer user-token' },
        credentials: 'omit',
      }),
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://history.local/api/scans',
      expect.objectContaining({
        method: 'GET',
        headers: { authorization: 'Bearer user-token' },
      }),
    );
  });

  it('keeps a real scan photo in the widget image slot', async () => {
    const fetchImpl = mockFetch(() => ({ userId: '123', scans: [] }));
    const faceAge: FaceAgeLike = {
      w: { globals: { imageSubmit: 'https://cdn.example.com/face.jpg' } },
      API: {
        getAdvisorData: () => Promise.resolve(),
        setHistoryData: () => Promise.resolve(true),
        removeHistoryItem: () => Promise.resolve(true),
      },
    };
    await attach(faceAge, { baseUrl: 'http://history.local', accessToken: 'user-token', fetch: fetchImpl, restoreOnAttach: false });
    expect(faceAge.w?.globals?.imageSubmit).toBe('https://cdn.example.com/face.jpg');
  });

  it('sends the bearer token and refuses the server API key', async () => {
    const fetchImpl = mockFetch(() => ({ userId: '123', scans: [] }));
    const client = createClient({ baseUrl: 'http://history.local/', accessToken: 'user-token', fetch: fetchImpl });
    await client.list();
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://history.local/api/scans',
      expect.objectContaining({
        headers: { authorization: 'Bearer user-token' },
        credentials: 'omit',
      }),
    );

    const withKey = { baseUrl: 'http://history.local', apiKey: 'test-api-key', accessToken: 'user-token' };
    expect(() => createClient(withKey as HistoryClientOptions)).toThrow(/API key/);
  });

  it('can call a same-origin store proxy without a token or user id', async () => {
    const fetchImpl = mockFetch(() => ({ userId: '123', scans: [], deleted: 1 }));
    const client = createClient({ baseUrl: '', sessionProxy: true, fetch: fetchImpl });
    await client.save({ analysis: { analyze_ref_token: 'analyze_ref_proxy' } });
    await client.deleteUser();
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/scans',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ payload: { analysis: { analyze_ref_token: 'analyze_ref_proxy' } } }),
      }),
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/users/me',
      expect.objectContaining({ method: 'DELETE', credentials: 'include', headers: {} }),
    );
  });
});
