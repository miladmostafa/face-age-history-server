export { createClient, attach, restoreHistory } from './client.js';
export type {
  AttachOptions,
  FaceAgeLike,
  FetchLike,
  HistoryClient,
  HistoryClientOptions,
  ScanListResponse,
  ExportResponse,
} from './client.js';
export { toHistoryItem, toHistoryDocument, extractRefToken } from '../history.js';
export type { HistoryItem, HistoryDocument, HistoryMeta, ScanRecord } from '../history.js';
