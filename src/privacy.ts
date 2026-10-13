import { isPlainObject } from './history.js';

const FACIAL_IMAGE_KEYS = new Set([
  'bascode',
  'bas_code',
  'imagebase64',
  'image_base64',
  'imagesubmit',
  'imagewebcam',
  'image_submit',
  'image_webcam',
  'afterimage',
  'beforeimage',
  'selfie',
]);

function isHttpUrl(value: string): boolean {
  return value.startsWith('https://') || value.startsWith('http://');
}

const IMAGE_MAGIC_PREFIXES = ['PHN2Zy', 'iVBORw0KGgo', '/9j/', 'R0lGOD', 'UklGR'];

/** Data URLs, image-magic base64, and long base64 blobs are treated as embedded images. */
export function looksLikeEmbeddedImage(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return true;
  const compact = trimmed.replace(/\s+/g, '');
  if (compact.length >= 24 && IMAGE_MAGIC_PREFIXES.some((prefix) => compact.startsWith(prefix))) return true;
  if (compact.length < 2048) return false;
  return /^[A-Za-z0-9+/=]+$/.test(compact);
}

function shouldDrop(key: string, value: string, path: string, storeImages: boolean): boolean {
  const lower = key.toLowerCase();
  if (looksLikeEmbeddedImage(value)) return true;
  if (FACIAL_IMAGE_KEYS.has(lower)) return true;
  const isMetaImage = path === 'meta.image' || path.endsWith('.meta.image');
  if (isMetaImage || lower === 'photo') {
    return !(storeImages && isHttpUrl(value));
  }
  return false;
}

/**
 * Remove facial photos. https product image URLs on catalog objects are kept
 * so a restored scan can still render recommendations. Set storeImages to
 * also keep an http(s) meta.image URL.
 */
export function stripImages(value: unknown, storeImages = false, path = ''): unknown {
  if (Array.isArray(value)) {
    return value
      .map((entry, index) => stripImages(entry, storeImages, `${path}[${index}]`))
      .filter((entry) => entry !== undefined);
  }
  if (isPlainObject(value)) {
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      if (typeof entry === 'string' && shouldDrop(key, entry, childPath, storeImages)) {
        continue;
      }
      const stripped = stripImages(entry, storeImages, childPath);
      if (stripped !== undefined) next[key] = stripped;
    }
    return next;
  }
  if (typeof value === 'string' && looksLikeEmbeddedImage(value)) return undefined;
  return value;
}
