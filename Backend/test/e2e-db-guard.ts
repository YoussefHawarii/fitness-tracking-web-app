import { readFileSync } from 'fs';
import { join } from 'path';

// e2e tests sign up users and create, edit and delete rows, so they must only
// ever run against a local database (the Docker Postgres in the repo-root
// docker-compose.yml). This refuses to start the suite when DATABASE_URL
// points anywhere else — e.g. a .env accidentally left on the production
// Supabase URL. Set E2E_ALLOW_REMOTE_DB=1 only for a deliberate, disposable
// remote database.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function effectiveDatabaseUrl(): string | undefined {
  // Same precedence as @nestjs/config and Prisma: an already-set environment
  // variable wins over Backend/.env.
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(join(__dirname, '..', '.env'), 'utf8');
    const line = env.split(/\r?\n/).find((l) => /^DATABASE_URL=/.test(l));
    return line
      ?.replace(/^DATABASE_URL=/, '')
      .trim()
      .replace(/^"(.*)"$/, '$1');
  } catch {
    return undefined;
  }
}

export default function e2eDatabaseGuard(): void {
  if (process.env.E2E_ALLOW_REMOTE_DB === '1') return;
  const url = effectiveDatabaseUrl();
  if (!url) {
    throw new Error('e2e: DATABASE_URL is not set (see Backend/.env.example).');
  }
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error('e2e: DATABASE_URL is not a valid URL.');
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `e2e: refusing to run against non-local database host "${host}". ` +
        'Point DATABASE_URL at the local Docker Postgres (docker compose up -d).',
    );
  }
}
