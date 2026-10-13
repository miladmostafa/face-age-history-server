import type { PrismaClient, Scan } from '@prisma/client';
import { decryptString, encryptString } from './crypto.js';
import { enforceScanCap, purgeExpired } from './db.js';
import { extractRefToken, type HistoryItem, type ScanRecord } from './history.js';
import { HttpError } from './http-error.js';
import { stripImages } from './privacy.js';
import { historyItemSchema, userIdSchema, type HistoryItemInput } from './schemas.js';

export interface ScanServiceOptions {
  encryptionKey: string;
  retentionDays: number;
  maxScansPerUser: number;
  maxPayloadBytes: number;
  storeImages: boolean;
}

function toRecord(row: Scan, payload: HistoryItem, created?: boolean): ScanRecord {
  return {
    id: row.id,
    userId: row.externalUserId,
    analyzeRefToken: row.analyzeRefToken,
    payload,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(created === undefined ? {} : { created }),
  };
}

function readPayload(row: Scan, encryptionKey: string): HistoryItem {
  const json = decryptString(row.payloadEncrypted, encryptionKey);
  const parsed: unknown = JSON.parse(json);
  const item = historyItemSchema.parse(parsed);
  return item as HistoryItem;
}

export function normalizeIncomingPayload(
  input: unknown,
  options: Pick<ScanServiceOptions, 'storeImages' | 'maxPayloadBytes'>,
  now = Date.now(),
): { token: string; item: HistoryItem } {
  const parsed = historyItemSchema.parse(input);
  const stripped = stripImages(parsed, options.storeImages);
  const item = historyItemSchema.parse(stripped) as HistoryItemInput;
  const token = extractRefToken(item.analysis);
  if (!token || token.length > 200) {
    throw new HttpError(
      400,
      'analysis.analyze_ref_token is required. It is the face-age dedupe key for a scan.',
    );
  }
  item.analysis.analyze_ref_token = token;
  if (!item.meta) item.meta = {};
  if (typeof item.meta.ts !== 'number') item.meta.ts = now;

  const encoded = JSON.stringify(item);
  if (Buffer.byteLength(encoded, 'utf8') > options.maxPayloadBytes) {
    throw new HttpError(413, `Scan payload exceeds ${options.maxPayloadBytes} bytes after image removal`, 'payload_too_large');
  }
  return { token, item: item as HistoryItem };
}

export function createScanService(prisma: PrismaClient, options: ScanServiceOptions) {
  return {
    async create(userId: string, payload: unknown): Promise<ScanRecord> {
      const user = userIdSchema.parse(userId);
      const { token, item } = normalizeIncomingPayload(payload, options);
      const payloadEncrypted = encryptString(JSON.stringify(item), options.encryptionKey);
      const where = { externalUserId_analyzeRefToken: { externalUserId: user, analyzeRefToken: token } };
      const existing = await prisma.scan.findUnique({ where });
      const row = existing
        ? await prisma.scan.update({ where, data: { payloadEncrypted } })
        : await prisma.scan.create({
            data: { externalUserId: user, analyzeRefToken: token, payloadEncrypted },
          });
      await purgeExpired(prisma, options.retentionDays);
      await enforceScanCap(prisma, user, options.maxScansPerUser);
      const fresh = await prisma.scan.findUnique({ where: { id: row.id } });
      if (!fresh) {
        throw new HttpError(404, 'Scan was removed by the retention limit', 'not_found');
      }
      return toRecord(fresh, item, !existing);
    },

    async list(userId: string, limit = 50, offset = 0): Promise<ScanRecord[]> {
      const user = userIdSchema.parse(userId);
      await purgeExpired(prisma, options.retentionDays);
      const rows = await prisma.scan.findMany({
        where: { externalUserId: user },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: offset,
      });
      return rows.map((row) => toRecord(row, readPayload(row, options.encryptionKey)));
    },

    async removeById(id: string, ownerUserId?: string): Promise<ScanRecord> {
      const row = await prisma.scan.findUnique({ where: { id } });
      if (!row || (ownerUserId !== undefined && row.externalUserId !== ownerUserId)) {
        throw new HttpError(404, 'Scan not found', 'not_found');
      }
      await prisma.scan.delete({ where: { id } });
      return toRecord(row, readPayload(row, options.encryptionKey));
    },

    async removeByToken(userId: string, token: string): Promise<ScanRecord> {
      const user = userIdSchema.parse(userId);
      const row = await prisma.scan.findUnique({
        where: { externalUserId_analyzeRefToken: { externalUserId: user, analyzeRefToken: token } },
      });
      if (!row) throw new HttpError(404, 'Scan not found', 'not_found');
      await prisma.scan.delete({ where: { id: row.id } });
      return toRecord(row, readPayload(row, options.encryptionKey));
    },

    async deleteUser(userId: string): Promise<number> {
      const user = userIdSchema.parse(userId);
      const result = await prisma.scan.deleteMany({ where: { externalUserId: user } });
      return result.count;
    },

    async exportUser(userId: string): Promise<{ userId: string; exportedAt: string; scans: ScanRecord[] }> {
      const scans = await this.list(userId, 1000, 0);
      return { userId: userIdSchema.parse(userId), exportedAt: new Date().toISOString(), scans };
    },
  };
}

export type ScanService = ReturnType<typeof createScanService>;
