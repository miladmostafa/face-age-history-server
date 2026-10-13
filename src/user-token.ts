import { createHmac, timingSafeEqual } from 'node:crypto';
import { userIdSchema } from './schemas.js';

export interface UserTokenClaims {
  sub: string;
  iat: number;
  exp: number;
}

export interface MintedUserToken {
  accessToken: string;
  tokenType: 'Bearer';
  userId: string;
  expiresAt: string;
}

const TOKEN_PREFIX = 'v1';

function sign(input: string, secret: string): string {
  return createHmac('sha256', secret).update(input).digest('base64url');
}

function signaturesMatch(presented: string, expected: string): boolean {
  const left = Buffer.from(presented);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** HMAC token scoped to one store user. The browser helper sends this, never the API key. */
export function mintUserToken(
  userId: string,
  secret: string,
  ttlSeconds: number,
  now = Date.now(),
): MintedUserToken {
  const subject = userIdSchema.parse(userId);
  if (!Number.isFinite(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 86_400) {
    throw new Error('Token lifetime must be between 60 and 86400 seconds');
  }
  const iat = Math.floor(now / 1000);
  const exp = iat + Math.floor(ttlSeconds);
  const payload = Buffer.from(JSON.stringify({ sub: subject, iat, exp }), 'utf8').toString('base64url');
  const signingInput = `${TOKEN_PREFIX}.${payload}`;
  const accessToken = `${signingInput}.${sign(signingInput, secret)}`;
  return {
    accessToken,
    tokenType: 'Bearer',
    userId: subject,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export function verifyUserToken(token: string, secret: string, now = Date.now()): UserTokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null;
  const signingInput = `${parts[0]}.${parts[1]}`;
  if (!signaturesMatch(parts[2], sign(signingInput, secret))) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const claims = parsed as Partial<UserTokenClaims>;
  if (typeof claims.sub !== 'string' || typeof claims.iat !== 'number' || typeof claims.exp !== 'number') return null;
  if (!userIdSchema.safeParse(claims.sub).success) return null;
  if (claims.exp * 1000 <= now) return null;
  return { sub: claims.sub, iat: claims.iat, exp: claims.exp };
}
