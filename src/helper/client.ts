import { toHistoryDocument, toHistoryItem, type HistoryItem, type ScanRecord, type ToHistoryOptions } from '../history.js';

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
}

export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    credentials?: 'include' | 'omit' | 'same-origin';
  },
) => Promise<FetchResponseLike>;

export interface HistoryClientOptions {
  baseUrl: string;
  /** Short-lived token from POST /api/tokens. Scoped to one user. Never the server API key. */
  accessToken?: string;
  /**
   * Call a same-origin store proxy with cookies. The proxy adds the API key and
   * the logged-in user id. Do not combine this with accessToken.
   */
  sessionProxy?: boolean;
  fetch?: FetchLike;
}

export interface ScanListResponse {
  userId: string;
  scans: ScanRecord[];
}

export interface ExportResponse extends ScanListResponse {
  exportedAt: string;
}

export interface FaceAgeLike {
  API: {
    getAdvisorData: (callback: (data: unknown) => void) => Promise<unknown> | unknown;
    setHistoryData: (data: unknown) => Promise<unknown> | unknown;
    removeHistoryItem: (token?: string | null) => Promise<unknown> | unknown;
  };
  w?: {
    globals?: {
      skinAnalyzeData?: unknown;
      formData?: unknown;
      imageSubmit?: string | null;
    };
  };
}

export interface AttachOptions extends HistoryClientOptions {
  syncOnScan?: boolean;
  restoreOnAttach?: boolean;
  includeImage?: boolean;
  onSync?: (scan: ScanRecord) => void;
  onRestore?: (count: number) => void;
  onError?: (error: Error) => void;
}

const MASTER_KEY_ERROR =
  'The browser helper cannot use the history server API key. Mint a short-lived accessToken on your store backend.';

/** 1×1 transparent PNG. Keeps the widget from compositing face overlays onto a missing photo. */
const BLANK_SCAN_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';

function ensureImageSlot(faceAge: FaceAgeLike): void {
  const globals = faceAge.w?.globals;
  if (!globals) return;
  if (typeof globals.imageSubmit === 'string' && globals.imageSubmit.trim().length > 0) return;
  globals.imageSubmit = BLANK_SCAN_IMAGE;
}

function defaultFetch(): FetchLike {
  const fetchImpl = (globalThis as { fetch?: FetchLike }).fetch;
  if (!fetchImpl) throw new Error('fetch is not available');
  return fetchImpl.bind(globalThis);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function assertBrowserCredentials(options: HistoryClientOptions): void {
  if ('apiKey' in options && (options as { apiKey?: unknown }).apiKey !== undefined) {
    throw new Error(MASTER_KEY_ERROR);
  }
  const token = typeof options.accessToken === 'string' ? options.accessToken.trim() : '';
  const proxy = options.sessionProxy === true;
  if (Boolean(token) === proxy) {
    throw new Error('Pass accessToken or sessionProxy: true, and only one of them.');
  }
}

async function readError(response: FetchResponseLike): Promise<Error> {
  try {
    const body = (await response.json()) as { message?: string };
    if (body && typeof body.message === 'string') return new Error(body.message);
  } catch {
    // The body was not JSON.
  }
  return new Error(response.statusText || `Request failed (${response.status})`);
}

export function createClient(options: HistoryClientOptions) {
  assertBrowserCredentials(options);
  const fetchImpl = options.fetch ?? defaultFetch();
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const accessToken = options.accessToken?.trim();
  const sessionProxy = options.sessionProxy === true;

  async function request(path: string, init?: { method?: string; body?: unknown }): Promise<unknown> {
    const hasBody = init?.body !== undefined;
    const headers: Record<string, string> = {};
    if (hasBody) headers['content-type'] = 'application/json';
    if (accessToken) headers.authorization = `Bearer ${accessToken}`;
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: init?.method ?? 'GET',
      headers,
      credentials: sessionProxy ? 'include' : 'omit',
      body: hasBody ? JSON.stringify(init.body) : undefined,
    });
    if (!response.ok) throw await readError(response);
    if (response.status === 204) return null;
    return response.json();
  }

  return {
    save(payload: HistoryItem | unknown): Promise<ScanRecord> {
      return request('/api/scans', { method: 'POST', body: { payload } }) as Promise<ScanRecord>;
    },
    list(): Promise<ScanListResponse> {
      return request('/api/scans') as Promise<ScanListResponse>;
    },
    deleteByToken(token: string): Promise<ScanRecord> {
      const query = new URLSearchParams({ token });
      return request(`/api/scans?${query.toString()}`, { method: 'DELETE' }) as Promise<ScanRecord>;
    },
    deleteUser(): Promise<{ userId: string; deleted: number }> {
      return request('/api/users/me', { method: 'DELETE' }) as Promise<{ userId: string; deleted: number }>;
    },
    exportUser(): Promise<ExportResponse> {
      return request('/api/users/me/export') as Promise<ExportResponse>;
    },
  };
}

export type HistoryClient = ReturnType<typeof createClient>;

function liveReport(faceAge: FaceAgeLike): unknown {
  return faceAge.w?.globals?.skinAnalyzeData;
}

export async function restoreHistory(faceAge: FaceAgeLike, scans: ScanRecord[], now = Date.now()): Promise<number> {
  const items = scans.map((scan) => scan.payload).filter((payload): payload is HistoryItem => Boolean(payload));
  const document = toHistoryDocument(items, now);
  if (!document) return 0;
  await faceAge.API.setHistoryData(document);
  return Object.keys(document.items).length;
}

/**
 * Register getAdvisorData, restore saved scans, and mirror removeHistoryItem to the server.
 * Call this before faceAge.render() so the widget can open the history gate.
 * Pass a per-user accessToken, or sessionProxy for a same-origin store backend. Never the API key.
 */
export async function attach(faceAge: FaceAgeLike, options: AttachOptions): Promise<{ client: HistoryClient; restored: number }> {
  if (!faceAge?.API?.getAdvisorData || !faceAge.API.setHistoryData || !faceAge.API.removeHistoryItem) {
    throw new Error('FaceAge API is missing getAdvisorData, setHistoryData, or removeHistoryItem');
  }

  const client = createClient(options);
  const reportError = (error: unknown) => options.onError?.(asError(error));
  const originalRemove = faceAge.API.removeHistoryItem.bind(faceAge.API);

  faceAge.API.removeHistoryItem = async (token?: string | null) => {
    let removed: unknown = false;
    try {
      removed = await originalRemove(token);
    } catch (error) {
      reportError(error);
    }
    try {
      if (token == null || token === '') await client.deleteUser();
      else await client.deleteByToken(token);
    } catch (error) {
      reportError(error);
    }
    return removed;
  };

  if (options.syncOnScan !== false) {
    faceAge.API.getAdvisorData((data) => {
      const historyOptions: ToHistoryOptions = {
        liveReport: liveReport(faceAge),
        activeSelections: faceAge.w?.globals?.formData,
        includeImage: options.includeImage === true,
      };
      const item = toHistoryItem(data, historyOptions);
      if (!item) {
        reportError(
          new Error(
            'This scan has no analyze_ref_token. face-age 2.4.13 passes the problems array to getAdvisorData; the helper also reads the widget report for the token.',
          ),
        );
        return;
      }
      client
        .save(item)
        .then((scan) => options.onSync?.(scan))
        .catch(reportError);
    });
  }

  let restored = 0;
  if (options.restoreOnAttach !== false) {
    const list = await client.list();
    restored = await restoreHistory(faceAge, list.scans);
    options.onRestore?.(restored);
  }

  ensureImageSlot(faceAge);
  return { client, restored };
}
