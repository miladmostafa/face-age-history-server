import { toHistoryDocument, toHistoryItem, type HistoryItem, type ScanRecord, type ToHistoryOptions } from '../history.js';

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
}

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<FetchResponseLike>;

export interface HistoryClientOptions {
  baseUrl: string;
  apiKey: string;
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
    };
  };
}

export interface AttachOptions extends HistoryClientOptions {
  userId: string;
  syncOnScan?: boolean;
  restoreOnAttach?: boolean;
  includeImage?: boolean;
  onSync?: (scan: ScanRecord) => void;
  onRestore?: (count: number) => void;
  onError?: (error: Error) => void;
}

function defaultFetch(): FetchLike {
  const fetchImpl = (globalThis as { fetch?: FetchLike }).fetch;
  if (!fetchImpl) throw new Error('fetch is not available');
  return fetchImpl.bind(globalThis);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
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
  const fetchImpl = options.fetch ?? defaultFetch();
  const baseUrl = options.baseUrl.replace(/\/$/, '');

  async function request(path: string, init?: { method?: string; body?: unknown }): Promise<unknown> {
    const hasBody = init?.body !== undefined;
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        ...(hasBody ? { 'content-type': 'application/json' } : {}),
        'x-api-key': options.apiKey,
      },
      body: hasBody ? JSON.stringify(init.body) : undefined,
    });
    if (!response.ok) throw await readError(response);
    if (response.status === 204) return null;
    return response.json();
  }

  return {
    save(userId: string, payload: HistoryItem | unknown): Promise<ScanRecord> {
      return request('/api/scans', { method: 'POST', body: { userId, payload } }) as Promise<ScanRecord>;
    },
    list(userId: string): Promise<ScanListResponse> {
      const query = new URLSearchParams({ user: userId });
      return request(`/api/scans?${query.toString()}`) as Promise<ScanListResponse>;
    },
    deleteByToken(userId: string, token: string): Promise<ScanRecord> {
      const query = new URLSearchParams({ user: userId, token });
      return request(`/api/scans?${query.toString()}`, { method: 'DELETE' }) as Promise<ScanRecord>;
    },
    deleteUser(userId: string): Promise<{ userId: string; deleted: number }> {
      return request(`/api/users/${encodeURIComponent(userId)}`, { method: 'DELETE' }) as Promise<{
        userId: string;
        deleted: number;
      }>;
    },
    exportUser(userId: string): Promise<ExportResponse> {
      return request(`/api/users/${encodeURIComponent(userId)}/export`) as Promise<ExportResponse>;
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
      if (token == null || token === '') await client.deleteUser(options.userId);
      else await client.deleteByToken(options.userId, token);
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
        .save(options.userId, item)
        .then((scan) => options.onSync?.(scan))
        .catch(reportError);
    });
  }

  let restored = 0;
  if (options.restoreOnAttach !== false) {
    const list = await client.list(options.userId);
    restored = await restoreHistory(faceAge, list.scans);
    options.onRestore?.(restored);
  }

  return { client, restored };
}
