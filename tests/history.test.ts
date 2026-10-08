import { describe, expect, it } from 'vitest';
import { decryptString, encryptString } from '../src/crypto.js';
import { extractRefToken, toHistoryDocument, toHistoryItem } from '../src/history.js';
import { stripImages } from '../src/privacy.js';

const secret = 'test-encryption-key-please-change';

describe('encryption', () => {
  it('round-trips a payload and uses a fresh IV', () => {
    const first = encryptString('{"skinAge":28}', secret);
    const second = encryptString('{"skinAge":28}', secret);
    expect(first).not.toBe(second);
    expect(first.startsWith('v1.')).toBe(true);
    expect(decryptString(first, secret)).toBe('{"skinAge":28}');
    expect(first.includes('skinAge')).toBe(false);
  });

  it('rejects a tampered ciphertext', () => {
    const encrypted = encryptString('hello', secret);
    const broken = `${encrypted.slice(0, -2)}aa`;
    expect(() => decryptString(broken, secret)).toThrow();
  });
});

describe('image stripping', () => {
  const payload = {
    analysis: {
      analyze_ref_token: 'analyze_ref_abc123',
      skinAge: 28,
      basCode: 'data:image/jpeg;base64,AAAA',
      problems: [{ key: 'pores', number: 10 }],
    },
    activeSelections: { email: 'shopper@example.com' },
    productLists: [{ id: 1, title: 'Serum', image: 'https://cdn.example.com/serum.png' }],
    meta: { ts: 10, image: 'https://cdn.example.com/face.jpg' },
  };

  it('drops facial photos and keeps product URLs by default', () => {
    const stripped = stripImages(payload, false) as typeof payload;
    expect(stripped.analysis.basCode).toBeUndefined();
    expect(stripped.analysis.analyze_ref_token).toBe('analyze_ref_abc123');
    expect(stripped.meta.image).toBeUndefined();
    expect(stripped.productLists[0].image).toBe('https://cdn.example.com/serum.png');
  });

  it('can keep an http meta image when explicitly enabled', () => {
    const stripped = stripImages(payload, true) as typeof payload;
    expect(stripped.meta.image).toBe('https://cdn.example.com/face.jpg');
    expect(stripped.analysis.basCode).toBeUndefined();
  });

  it('drops long base64 blobs', () => {
    const blob = 'A'.repeat(3000);
    const stripped = stripImages({ note: blob, keep: 'short' }, false) as { note?: string; keep: string };
    expect(stripped.note).toBeUndefined();
    expect(stripped.keep).toBe('short');
  });
});

describe('history normalization', () => {
  it('accepts the documented advisor object', () => {
    const item = toHistoryItem({
      analysis: {
        analyze_ref_token: 'analyze_ref_abc123',
        skinAge: 28,
        damagePercentage: 12.4,
        problems: [],
      },
      activeSelections: { skinType: 'combination' },
      meta: { ts: 50, image: 'data:image/jpeg;base64,AAAA', quality: { lightingScore: 0.92, blur: 120 } },
    });
    expect(item?.analysis.analyze_ref_token).toBe('analyze_ref_abc123');
    expect(item?.analysis.skinAge).toBe(28);
    expect(item?.activeSelections).toEqual({ skinType: 'combination' });
    expect(item?.meta?.ts).toBe(50);
    expect(item?.meta?.image).toBeUndefined();
    expect(item?.meta?.quality).toEqual({ lightingScore: 0.92 });
  });

  it('merges the 2.4.13 problems array with the live report', () => {
    const item = toHistoryItem(
      {
        analysis: [{ key: 'acne', title: 'Acne', number: 8 }],
        activeSelections: { email: 'a@example.com' },
      },
      {
        liveReport: {
          analyze_ref_token: 'analyze_ref_live',
          skinAge: 29,
          damagePercentage: 18,
          basCode: 'data:image/jpeg;base64,BBBB',
        },
        now: 99,
      },
    );
    expect(extractRefToken(item?.analysis)).toBe('analyze_ref_live');
    expect(item?.analysis.skinAge).toBe(29);
    expect(item?.analysis.problems).toEqual([{ key: 'acne', title: 'Acne', number: 8 }]);
    expect(item?.meta?.ts).toBe(99);
  });

  it('refuses a problems array that has no token', () => {
    expect(toHistoryItem({ analysis: [{ key: 'pores', number: 1 }], activeSelections: {} })).toBeNull();
  });

  it('builds one history document keyed by analyze_ref_token', () => {
    const older = toHistoryItem({
      analysis: { analyze_ref_token: 'older', skinAge: 32 },
      activeSelections: {},
      meta: { ts: 10 },
    });
    const newer = toHistoryItem({
      analysis: { analyzeRefToken: 'newer', skinAge: 29 },
      activeSelections: {},
      meta: { ts: 20 },
    });
    const document = toHistoryDocument([older!, newer!], 30);
    expect(document?.latestRefId).toBe('newer');
    expect(Object.keys(document?.items ?? {}).sort()).toEqual(['newer', 'older']);
    expect(document?.items.newer.analysis.analyze_ref_token).toBe('newer');
  });
});
