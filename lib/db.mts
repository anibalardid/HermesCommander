// db.mts — test-DB helper for test.sh: apply migrations and validate state.
//
// The LaOficina backend (apps/server) uses SQLite via better-sqlite3. The
// schema + additive migrations live in the Store constructor (db/store.ts),
// which is idempotent: `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE` guards.
// This helper wraps that so test.sh can run "migrate" and "validate" as two
// distinct, confirmable steps without duplicating the migration logic.
//
// Safety:
//   - Refuses to run against the production DB path (data/laoficina.db) so a
//     test run can never clobber real data. The test DB must be a throwaway
//     path (test.sh creates one under a temp dir).
//   - Surfaces errors clearly and exits non-zero on any failure.
//
// Usage (via test.sh):
//   LAOFICINA_DB=<path> node_modules/.bin/tsx scripts/lib/db.mts migrate
//   LAOFICINA_DB=<path> node_modules/.bin/tsx scripts/lib/db.mts validate
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { Store } from '../apps/server/src/db/store.js';

const dbPath = process.env.LAOFICINA_DB ?? 'data/test.db';
const mode = process.argv[2] ?? 'migrate';

// The production DB path. Running migrations/validation against it from a test
// helper is never intended — refuse loudly rather than risk clobbering data.
const PROD_DB = resolve('data/laoficina.db');

function fail(msg: string): never {
  console.error(`db.mts: ${msg}`);
  process.exit(1);
}

if (resolve(dbPath) === PROD_DB) {
  fail(
    `refusing to run against the production database (${PROD_DB}). ` +
      `Set LAOFICINA_DB to a throwaway test path (e.g. a temp dir).`
  );
}

if (mode === 'migrate') {
  // Instantiating Store runs the schema (CREATE TABLE IF NOT EXISTS), the
  // additive migrations, and the default agent/recipe seeds — all idempotent.
  try {
    new Store(dbPath);
  } catch (err) {
    fail(`migrations failed on ${dbPath}: ${(err as Error).message}`);
  }
  console.log(`Migrations applied: ${dbPath}`);
} else if (mode === 'validate') {
  if (!existsSync(dbPath)) {
    fail(`no database file at ${dbPath} — run migrations first.`);
  }
  let db: Database.Database;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch (err) {
    fail(`could not open ${dbPath} for validation: ${(err as Error).message}`);
  }
  try {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as Array<{ name: string }>;
    console.log(`Tables (${tables.length}):`);
    for (const t of tables) {
      const { c } = db.prepare(`SELECT COUNT(*) AS c FROM "${t.name}"`).get() as { c: number };
      console.log(`  ${t.name}: ${c} row(s)`);
    }
  } catch (err) {
    fail(`validation failed on ${dbPath}: ${(err as Error).message}`);
  } finally {
    db.close();
  }
} else {
  fail(`unknown mode: ${mode} (expected 'migrate' or 'validate')`);
}
