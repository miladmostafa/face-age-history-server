import { timingSafeEqual } from 'node:crypto';

export function extractApiKey(authorization: string | undefined, apiKeyHeader: string | undefined): string | null {
  if (typeof apiKeyHeader === 'string' && apiKeyHeader.trim()) return apiKeyHeader.trim();
  if (typeof authorization !== 'string') return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization.trim());
  return match ? match[1] : null;
}

export function apiKeyAllowed(presented: string, keys: readonly string[]): boolean {
  const left = Buffer.from(presented);
  return keys.some((key) => {
    const right = Buffer.from(key);
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  });
}
