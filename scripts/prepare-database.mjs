import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

for (const name of ['.env', '.env.local']) {
  if (!existsSync(name)) continue;
  for (const line of readFileSync(name, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

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
