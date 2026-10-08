/**
 * Shapes confirmed against face-age 2.4.13 (dist/faceage.js and the package README).
 *
 * getAdvisorData(callback) later invokes callback({ analysis, activeSelections }).
 * In 2.4.13 the value passed as `analysis` is the problems array. The README
 * describes `analysis` as the report object (skinAge, damagePercentage,
 * problems, analyze_ref_token). setHistoryData accepts either one report or
 * `{ latestRefId, items }` keyed by that token. removeHistoryItem(token)
 * deletes one entry only when history was loaded as that items map.
 */

export const REF_TOKEN_KEYS = ['analyze_ref_token', 'analyzeRefToken', 'ref_id', 'refId'] as const;

export interface HistoryQuality {
  lightingScore?: number;
  lighting?: number;
  brightness?: number;
  sharpnessScore?: number;
  sharpness?: number;
  blur?: number;
  noise?: number;
  confidence?: number;
}

export interface HistoryMeta {
  ts?: number;
  image?: string;
  quality?: HistoryQuality;
}

export interface HistoryItem {
  analysis: Record<string, unknown> & { analyze_ref_token: string };
  activeSelections: Record<string, unknown>;
  productLists?: unknown[] | null;
  customRoutineGroup?: unknown[] | null;
  meta?: HistoryMeta;
}

export interface HistoryDocument {
  latestRefId: string;
  updatedAt: number;
  items: Record<string, HistoryItem>;
}

export interface ScanRecord {
  id: string;
  userId: string;
  analyzeRefToken: string;
  payload: HistoryItem;
  createdAt: string;
  updatedAt: string;
  created?: boolean;
}

export interface ToHistoryOptions {
  now?: number;
  /** Full cloud report kept on the widget (`skinAnalyzeData`) when getAdvisorData only received problems. */
  liveReport?: unknown;
  activeSelections?: unknown;
  includeImage?: boolean;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function extractRefToken(value: unknown): string | null {
  if (!isPlainObject(value)) return null;
  for (const key of REF_TOKEN_KEYS) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

function copyQuality(value: unknown): HistoryQuality | undefined {
  if (!isPlainObject(value)) return undefined;
  const names = [
    'lightingScore',
    'lighting',
    'brightness',
    'sharpnessScore',
    'sharpness',
    'blur',
    'noise',
    'confidence',
  ] as const;
  const quality: HistoryQuality = {};
  for (const name of names) {
    const score = value[name];
    if (typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 100) {
      quality[name] = score;
    }
  }
  return Object.keys(quality).length > 0 ? quality : undefined;
}

function isHttpUrl(value: string): boolean {
  return value.startsWith('https://') || value.startsWith('http://');
}

/**
 * Turn a getAdvisorData callback value, or an already-shaped history item,
 * into the object setHistoryData stores.
 */
export function toHistoryItem(input: unknown, options: ToHistoryOptions = {}): HistoryItem | null {
  if (!isPlainObject(input)) return null;

  const now = options.now ?? Date.now();
  const rawAnalysis = input.analysis !== undefined ? input.analysis : input.skinAnalyzeData;
  let analysis: Record<string, unknown> | null = null;

  if (Array.isArray(rawAnalysis)) {
    const live = isPlainObject(options.liveReport) ? { ...options.liveReport } : {};
    analysis = { ...live, problems: rawAnalysis };
  } else if (isPlainObject(rawAnalysis)) {
    analysis = { ...rawAnalysis };
    if (isPlainObject(options.liveReport)) {
      for (const [key, value] of Object.entries(options.liveReport)) {
        if (analysis[key] === undefined) analysis[key] = value;
      }
    }
  } else if (rawAnalysis === undefined && extractRefToken(input)) {
    analysis = { ...input };
    delete analysis.activeSelections;
    delete analysis.meta;
    delete analysis.productLists;
    delete analysis.customRoutineGroup;
    delete analysis.formData;
  } else {
    return null;
  }

  const token = extractRefToken(analysis) ?? extractRefToken(input);
  if (!token) return null;
  analysis.analyze_ref_token = token;

  const selections = isPlainObject(input.activeSelections)
    ? input.activeSelections
    : isPlainObject(input.formData)
      ? input.formData
      : isPlainObject(options.activeSelections)
        ? options.activeSelections
        : {};

  const metaIn = isPlainObject(input.meta) ? input.meta : {};
  const meta: HistoryMeta = {};
  meta.ts = typeof metaIn.ts === 'number' && Number.isFinite(metaIn.ts) ? metaIn.ts : now;
  if (options.includeImage === true && typeof metaIn.image === 'string' && isHttpUrl(metaIn.image)) {
    meta.image = metaIn.image;
  }
  const quality = copyQuality(metaIn.quality);
  if (quality) meta.quality = quality;

  const item: HistoryItem = {
    analysis: analysis as HistoryItem['analysis'],
    activeSelections: selections,
    meta,
  };
  if (Array.isArray(input.productLists)) item.productLists = input.productLists;
  if (Array.isArray(input.customRoutineGroup)) item.customRoutineGroup = input.customRoutineGroup;
  return item;
}

/** One history document. Per-item setHistoryData calls replace earlier scans in face-age 2.4.13. */
export function toHistoryDocument(items: HistoryItem[], now = Date.now()): HistoryDocument | null {
  if (items.length === 0) return null;
  const map: Record<string, HistoryItem> = {};
  let latestRefId = '';
  let latestTs = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    const token = extractRefToken(item.analysis);
    if (!token) continue;
    map[token] = item;
    const ts = typeof item.meta?.ts === 'number' ? item.meta.ts : 0;
    if (ts >= latestTs) {
      latestTs = ts;
      latestRefId = token;
    }
  }
  if (!latestRefId) return null;
  return { latestRefId, updatedAt: now, items: map };
}
