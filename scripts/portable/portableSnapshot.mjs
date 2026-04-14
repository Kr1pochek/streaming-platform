import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, "../..");
const snapshotRoot = path.resolve(projectRoot, "portable-snapshot");
const snapshotDatabasePath = path.resolve(snapshotRoot, "database.json");
const snapshotMediaRoot = path.resolve(snapshotRoot, "media");
const localMediaRoot = path.resolve(projectRoot, "public/audio");
const SNAPSHOT_VERSION = 1;

const applicationTableOrder = [
  "users",
  "artists",
  "tracks",
  "playlists",
  "releases",
  "user_states",
  "user_sessions",
  "password_reset_tokens",
  "track_artists",
  "track_tags",
  "playlist_tracks",
  "release_tracks",
];

const signalTables = ["users", "tracks", "playlists", "releases"];

function parseBoolean(value, fallback = false) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function quoteIdentifier(identifier) {
  return `"${String(identifier ?? "").replace(/"/g, "\"\"")}"`;
}

function createPool(env = process.env) {
  return new Pool({
    host: env.PGHOST ?? "127.0.0.1",
    port: Number(env.PGPORT ?? 5432),
    database: env.PGDATABASE ?? "music_app",
    user: env.PGUSER ?? "postgres",
    password: env.PGPASSWORD ?? "",
  });
}

async function resolveExistingPublicTables(pool) {
  const { rows } = await pool.query(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_type = 'BASE TABLE'
      and table_name <> 'schema_migrations'
    order by table_name;
  `);
  return rows.map((row) => String(row.table_name ?? "").trim()).filter(Boolean);
}

async function resolveTableColumns(pool, tableName) {
  const { rows } = await pool.query(
    `
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = $1
    order by ordinal_position;
  `,
    [tableName]
  );
  return rows.map((row) => String(row.column_name ?? "").trim()).filter(Boolean);
}

async function resolvePrimaryKeyColumns(pool, tableName) {
  const { rows } = await pool.query(
    `
    select kcu.column_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name
     and tc.table_schema = kcu.table_schema
     and tc.table_name = kcu.table_name
    where tc.table_schema = 'public'
      and tc.table_name = $1
      and tc.constraint_type = 'PRIMARY KEY'
    order by kcu.ordinal_position;
  `,
    [tableName]
  );
  return rows.map((row) => String(row.column_name ?? "").trim()).filter(Boolean);
}

function orderedApplicationTables(existingTables) {
  const existingSet = new Set(existingTables);
  const ordered = applicationTableOrder.filter((tableName) => existingSet.has(tableName));
  for (const tableName of existingTables) {
    if (!ordered.includes(tableName)) {
      ordered.push(tableName);
    }
  }
  return ordered;
}

function countFilesRecursively(rootPath) {
  if (!fs.existsSync(rootPath)) {
    return 0;
  }
  const stack = [rootPath];
  let count = 0;
  while (stack.length) {
    const currentPath = stack.pop();
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const nextPath = path.resolve(currentPath, entry.name);
      if (entry.isDirectory()) {
        stack.push(nextPath);
        continue;
      }
      if (entry.isFile()) {
        count += 1;
      }
    }
  }
  return count;
}

function copyDirectoryRecursive(sourceRoot, destinationRoot) {
  if (!fs.existsSync(sourceRoot)) {
    return 0;
  }

  fs.mkdirSync(destinationRoot, { recursive: true });
  const stack = [{ sourcePath: sourceRoot, destinationPath: destinationRoot }];
  let fileCount = 0;

  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current.sourcePath, { withFileTypes: true });

    for (const entry of entries) {
      const sourcePath = path.resolve(current.sourcePath, entry.name);
      const destinationPath = path.resolve(current.destinationPath, entry.name);

      if (entry.isDirectory()) {
        fs.mkdirSync(destinationPath, { recursive: true });
        stack.push({ sourcePath, destinationPath });
        continue;
      }

      if (entry.isFile()) {
        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
        fs.copyFileSync(sourcePath, destinationPath);
        fileCount += 1;
      }
    }
  }

  return fileCount;
}

function replaceDirectoryContents(sourceRoot, destinationRoot) {
  fs.rmSync(destinationRoot, { recursive: true, force: true });
  fs.mkdirSync(destinationRoot, { recursive: true });
  if (!fs.existsSync(sourceRoot)) {
    return 0;
  }
  return copyDirectoryRecursive(sourceRoot, destinationRoot);
}

function loadSnapshotFromDisk() {
  if (!fs.existsSync(snapshotDatabasePath)) {
    return null;
  }
  const raw = fs.readFileSync(snapshotDatabasePath, "utf8");
  if (!raw.trim()) {
    return null;
  }
  return JSON.parse(raw);
}

async function exportTables(pool, tableNames) {
  const tables = [];
  for (const tableName of tableNames) {
    const columns = await resolveTableColumns(pool, tableName);
    const primaryKeyColumns = await resolvePrimaryKeyColumns(pool, tableName);
    const orderByClause = primaryKeyColumns.length
      ? ` order by ${primaryKeyColumns.map((columnName) => quoteIdentifier(columnName)).join(", ")}`
      : "";
    const { rows } = await pool.query(
      `select * from ${quoteIdentifier(tableName)}${orderByClause};`
    );
    tables.push({
      name: tableName,
      columns,
      rows,
    });
  }
  return tables;
}

function snapshotSummary(snapshot) {
  const tables = Array.isArray(snapshot?.tables) ? snapshot.tables : [];
  const rows = tables.reduce((sum, table) => sum + Number(table?.rows?.length ?? 0), 0);
  return {
    tableCount: tables.length,
    rowCount: rows,
  };
}

async function detectApplicationData(pool, existingTables) {
  const candidateTables = signalTables.filter((tableName) => existingTables.includes(tableName));
  if (!candidateTables.length) {
    return { hasData: false, details: [] };
  }

  const details = [];
  for (const tableName of candidateTables) {
    const { rows } = await pool.query(`select count(*)::int as count from ${quoteIdentifier(tableName)};`);
    const count = Number(rows[0]?.count ?? 0);
    details.push({ table: tableName, count });
  }

  return {
    hasData: details.some((entry) => entry.count > 0),
    details,
  };
}

async function restoreSnapshotTables(client, snapshotTables, currentTableColumnsMap) {
  for (const table of snapshotTables) {
    const currentColumns = currentTableColumnsMap.get(table.name) ?? [];
    const insertColumns = table.columns.filter((columnName) => currentColumns.includes(columnName));
    if (!insertColumns.length || !table.rows.length) {
      continue;
    }

    const columnList = insertColumns.map((columnName) => quoteIdentifier(columnName)).join(", ");

    for (const row of table.rows) {
      const values = insertColumns.map((columnName) => row[columnName]);
      const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
      await client.query(
        `insert into ${quoteIdentifier(table.name)} (${columnList}) values (${placeholders});`,
        values
      );
    }
  }
}

export async function exportPortableSnapshot({ env = process.env } = {}) {
  const pool = createPool(env);

  try {
    const existingTables = await resolveExistingPublicTables(pool);
    const tableNames = orderedApplicationTables(existingTables);
    const tables = await exportTables(pool, tableNames);

    fs.mkdirSync(snapshotRoot, { recursive: true });
    fs.writeFileSync(
      snapshotDatabasePath,
      `${JSON.stringify(
        {
          version: SNAPSHOT_VERSION,
          exportedAt: new Date().toISOString(),
          tables,
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const mediaFileCount = replaceDirectoryContents(localMediaRoot, snapshotMediaRoot);
    const summary = snapshotSummary({ tables });

    return {
      ...summary,
      mediaFileCount,
      snapshotDatabasePath,
      snapshotMediaRoot,
    };
  } finally {
    await pool.end();
  }
}

export async function restorePortableSnapshotIfNeeded({ env = process.env } = {}) {
  const snapshot = loadSnapshotFromDisk();
  if (!snapshot) {
    return {
      restored: false,
      reason: "snapshot-missing",
    };
  }

  const pool = createPool(env);

  try {
    const existingTables = await resolveExistingPublicTables(pool);
    const restoreOrder = orderedApplicationTables(existingTables);
    const snapshotTableMap = new Map(
      (Array.isArray(snapshot.tables) ? snapshot.tables : [])
        .filter((table) => existingTables.includes(table.name))
        .map((table) => [table.name, table])
    );
    const snapshotTables = restoreOrder.map((tableName) => snapshotTableMap.get(tableName)).filter(Boolean);

    if (!snapshotTables.length) {
      return {
        restored: false,
        reason: "snapshot-empty",
      };
    }

    const forceRestore = parseBoolean(env.PORTABLE_SNAPSHOT_FORCE_RESTORE, false);
    const dataCheck = await detectApplicationData(pool, existingTables);
    if (!forceRestore && dataCheck.hasData) {
      return {
        restored: false,
        reason: "database-not-empty",
        details: dataCheck.details,
      };
    }

    const currentTableColumnsMap = new Map();
    for (const tableName of restoreOrder) {
      currentTableColumnsMap.set(tableName, await resolveTableColumns(pool, tableName));
    }

    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `truncate table ${restoreOrder.map((tableName) => quoteIdentifier(tableName)).join(", ")} restart identity cascade;`
      );
      await restoreSnapshotTables(client, snapshotTables, currentTableColumnsMap);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    const restoreMedia = parseBoolean(env.PORTABLE_SNAPSHOT_RESTORE_MEDIA, true);
    const mediaFileCount = restoreMedia
      ? replaceDirectoryContents(snapshotMediaRoot, localMediaRoot)
      : 0;
    const summary = snapshotSummary(snapshot);

    return {
      restored: true,
      ...summary,
      mediaFileCount,
      forceRestore,
    };
  } finally {
    await pool.end();
  }
}
