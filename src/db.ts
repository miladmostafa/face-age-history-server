import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

export function ensureDatabaseDirectory(databaseUrl: string): void {
  if (!databaseUrl.startsWith('file:')) return;
  const filePart = databaseUrl.slice('file:'.length).split('?')[0];
  if (!filePart || filePart === ':memory:') return;
  const absolute = path.isAbsolute(filePart) ? filePart : path.resolve(filePart);
  mkdirSync(path.dirname(absolute), { recursive: true });
}

export function createPrismaClient(): PrismaClient {
  return new PrismaClient();
}

export async function purgeExpired(
  prisma: PrismaClient,
  retentionDays: number,
  now = new Date(),
): Promise<number> {
  if (retentionDays <= 0) return 0;
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const result = await prisma.scan.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return result.count;
}

export async function enforceScanCap(
  prisma: PrismaClient,
  externalUserId: string,
  maxScans: number,
): Promise<number> {
  const extra = await prisma.scan.findMany({
    where: { externalUserId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: maxScans,
    select: { id: true },
  });
  if (extra.length === 0) return 0;
  const result = await prisma.scan.deleteMany({ where: { id: { in: extra.map((row) => row.id) } } });
  return result.count;
}
