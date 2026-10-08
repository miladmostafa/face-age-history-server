import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const databaseUrl = process.env.DATABASE_URL || 'file:./data/history.db';
const provider = databaseUrl.startsWith('postgres') ? 'postgresql' : 'sqlite';

if (provider === 'sqlite' && databaseUrl.startsWith('file:')) {
  const filePart = databaseUrl.slice('file:'.length).split('?')[0];
  if (filePart && filePart !== ':memory:') {
    const absolute = path.isAbsolute(filePart) ? filePart : path.resolve(filePart);
    mkdirSync(path.dirname(absolute), { recursive: true });
  }
}

const schema = readFileSync(path.resolve('prisma/schema.prisma'), 'utf8').replace(
  /provider\s*=\s*"(sqlite|postgresql)"/,
  `provider = "${provider}"`,
);
const directory = mkdtempSync(path.join(tmpdir(), 'face-age-history-schema-'));
const schemaPath = path.join(directory, 'schema.prisma');
writeFileSync(schemaPath, schema);

const env = { ...process.env, DATABASE_URL: databaseUrl };
execSync(`npx prisma generate --schema "${schemaPath}"`, { stdio: 'inherit', env });
execSync(`npx prisma db push --schema "${schemaPath}" --skip-generate --accept-data-loss`, {
  stdio: 'inherit',
  env,
});
