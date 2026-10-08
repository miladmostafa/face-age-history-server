import { describe, expect, it } from 'vitest';
import { mintUserToken, verifyUserToken } from '../src/user-token.js';

const secret = 'test-token-secret-value';

describe('per-user access tokens', () => {
  it('round-trips a token scoped to one user', () => {
    const minted = mintUserToken('shopper-1', secret, 900, 1_700_000_000_000);
    expect(minted.tokenType).toBe('Bearer');
    expect(minted.userId).toBe('shopper-1');
    expect(minted.expiresAt).toBe('2023-11-14T22:28:20.000Z');
    const claims = verifyUserToken(minted.accessToken, secret, 1_700_000_000_000);
    expect(claims).toEqual({ sub: 'shopper-1', iat: 1_700_000_000, exp: 1_700_000_900 });
  });

  it('rejects a tampered token, the wrong secret, and an expired token', () => {
    const minted = mintUserToken('shopper-1', secret, 60, 1_700_000_000_000);
    const flipped = `${minted.accessToken.slice(0, -1)}${minted.accessToken.endsWith('a') ? 'b' : 'a'}`;
    expect(verifyUserToken(flipped, secret, 1_700_000_000_000)).toBeNull();
    expect(verifyUserToken(minted.accessToken, 'another-token-secret-value', 1_700_000_000_000)).toBeNull();
    expect(verifyUserToken(minted.accessToken, secret, 1_700_000_060_000)).toBeNull();
  });
});
