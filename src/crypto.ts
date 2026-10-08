import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_SALT = 'face-age-history-server-v1';

const keyCache = new Map<string, Buffer>();

export function encryptionKey(secret: string): Buffer {
  const cached = keyCache.get(secret);
  if (cached) return cached;
  const key = scryptSync(secret, KEY_SALT, 32);
  keyCache.set(secret, key);
  return key;
}

/** AES-256-GCM ciphertext. A random IV is stored with every value. */
export function encryptString(plaintext: string, secret: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${Buffer.concat([iv, tag, ciphertext]).toString('base64url')}`;
}

export function decryptString(payload: string, secret: string): string {
  if (!payload.startsWith('v1.')) {
    throw new Error('Unknown ciphertext version');
  }
  const buf = Buffer.from(payload.slice(3), 'base64url');
  if (buf.length < IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error('Ciphertext is truncated');
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
