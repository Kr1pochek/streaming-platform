import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.resolve(currentDirectory, "../../server/db/migrations");

const pool = new Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? "music_app",
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD ?? "",
});

function resolveMigrationFiles() {
  if (!fs.existsSync(migrationsDirectory)) {
    return [];
  }

  return fs
    .readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => ({
      id: entry.name,
      absolutePath: path.join(migrationsDirectory, entry.name),
    }))
    .sort((left, right) => left.id.localeCompare(right.id, "en"));
}

async function ensureMigrationsTable() {
  await pool.query(`
    create table if not exists schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    );
  `);
}

async function getAppliedMigrations() {
  const { rows } = await pool.query(`
    select id
    from schema_migrations
    order by id;
  `);
  return new Set(rows.map((row) => String(row.id ?? "")));
}

async function applyMigration(migration) {
  const sql = fs.readFileSync(migration.absolutePath, "utf8");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("insert into schema_migrations (id) values ($1);", [migration.id]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const migrations = resolveMigrationFiles();
  if (!migrations.length) {
    console.log(`No SQL migrations found in ${migrationsDirectory}`);
    return;
  }

  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();

  let appliedCount = 0;
  let skippedCount = 0;

  for (const migration of migrations) {
    if (applied.has(migration.id)) {
      skippedCount += 1;
      console.log(`skip ${migration.id}`);
      continue;
    }

    console.log(`apply ${migration.id}`);
    await applyMigration(migration);
    appliedCount += 1;
  }

  console.log(`migrations complete: applied=${appliedCount}, skipped=${skippedCount}, total=${migrations.length}`);
}

main()
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
