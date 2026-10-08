import { describe, expect, it, vi } from 'vitest';
import { attach, createClient, type FaceAgeLike, type FetchLike } from '../src/helper/index.js';

function mockFetch(handler: (url: string, init?: { method?: string; body?: string }) => unknown): FetchLike {
  return vi.fn(async (url, init) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => handler(url, init),
  }));
}

describe('browser helper client', () => {
  it('posts advisor data and restores every scan in one setHistoryData call', async () => {
    const saved: unknown[] = [];
    const fetchImpl = mockFetch((url, init) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(init.body ?? '{}') as { payload: unknown };
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
      apiKey: 'test-api-key',
      userId: '123',
      fetch: fetchImpl,
    });

    expect(result.restored).toBe(2);
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
      'http://history.local/api/scans?user=123&token=older',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('sends the API key header', async () => {
    const fetchImpl = mockFetch(() => ({ userId: '123', scans: [] }));
    const client = createClient({ baseUrl: 'http://history.local/', apiKey: 'test-api-key', fetch: fetchImpl });
    await client.list('123');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://history.local/api/scans?user=123',
      expect.objectContaining({ headers: expect.objectContaining({ 'x-api-key': 'test-api-key' }) }),
    );
  });
});
