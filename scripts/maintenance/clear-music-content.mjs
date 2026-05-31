import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { exportPortableSnapshot } from "../portable/portableSnapshot.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, "../..");
const publicAudioRoot = path.resolve(projectRoot, "public/audio");

const catalogTables = [
  "release_tracks",
  "playlist_tracks",
  "track_tags",
  "track_artists",
  "releases",
  "playlists",
  "tracks",
  "artists",
];

const userStateResetColumns = {
  liked_track_ids: "array[]::text[]",
  followed_artist_ids: "array[]::text[]",
  history_track_ids: "array[]::text[]",
  queue_track_ids: "array[]::text[]",
  queue_current_index: "0",
  queue_progress_sec: "0",
  queue_is_playing: "false",
  saved_playlist_ids: "array[]::text[]",
};

function createPool(env = process.env) {
  const connectionString = String(env.DATABASE_URL ?? "").trim();
  if (connectionString) {
    return new Pool({ connectionString });
  }

  return new Pool({
    host: env.PGHOST ?? "127.0.0.1",
    port: Number(env.PGPORT ?? 5432),
    database: env.PGDATABASE ?? "music_app",
    user: env.PGUSER ?? "postgres",
    password: env.PGPASSWORD ?? "",
  });
}

function quoteIdentifier(identifier) {
  return `"${String(identifier ?? "").replace(/"/g, "\"\"")}"`;
}

async function resolveTableColumns(client, tableName) {
  const { rows } = await client.query(
    `
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = $1;
    `,
    [tableName]
  );
  return new Set(rows.map((row) => String(row.column_name ?? "").trim()).filter(Boolean));
}

async function countRows(client, tableName) {
  const { rows } = await client.query(`select count(*)::int as count from ${quoteIdentifier(tableName)};`);
  return Number(rows[0]?.count ?? 0);
}

async function clearDatabase() {
  const pool = createPool();
  const client = await pool.connect();
  const deletedRows = {};

  try {
    await client.query("begin");

    const userStateColumns = await resolveTableColumns(client, "user_states");
    const resetAssignments = Object.entries(userStateResetColumns)
      .filter(([column]) => userStateColumns.has(column))
      .map(([column, value]) => `${quoteIdentifier(column)} = ${value}`);

    if (userStateColumns.has("updated_at")) {
      resetAssignments.push("updated_at = (extract(epoch from now()) * 1000)::bigint");
    }

    if (resetAssignments.length) {
      await client.query(`update user_states set ${resetAssignments.join(", ")};`);
    }

    for (const tableName of catalogTables) {
      deletedRows[tableName] = await countRows(client, tableName);
      await client.query(`delete from ${quoteIdentifier(tableName)};`);
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  return deletedRows;
}

function assertInside(rootPath, targetPath) {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to remove path outside ${root}: ${target}`);
  }
  return target;
}

function countFiles(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return 0;
  }

  const stats = fs.lstatSync(targetPath);
  if (stats.isFile()) {
    return 1;
  }

  if (!stats.isDirectory()) {
    return 0;
  }

  let count = 0;
  const stack = [targetPath];
  while (stack.length) {
    const currentPath = stack.pop();
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      const nextPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        stack.push(nextPath);
      } else if (entry.isFile()) {
        count += 1;
      }
    }
  }
  return count;
}

function removeTree(rootPath, targetPath) {
  const safeTargetPath = assertInside(rootPath, targetPath);
  if (!fs.existsSync(safeTargetPath)) {
    return 0;
  }

  const stats = fs.lstatSync(safeTargetPath);
  if (!stats.isDirectory()) {
    fs.unlinkSync(safeTargetPath);
    return 1;
  }

  let removedFiles = 0;
  for (const entry of fs.readdirSync(safeTargetPath, { withFileTypes: true })) {
    removedFiles += removeTree(rootPath, path.join(safeTargetPath, entry.name));
  }
  fs.rmdirSync(safeTargetPath);
  return removedFiles;
}

function removePublicMusicMedia() {
  const targets = [
    path.resolve(publicAudioRoot, "tracks"),
    path.resolve(publicAudioRoot, "hls"),
    path.resolve(publicAudioRoot, "demo-loop.wav"),
  ];

  let removedFiles = 0;
  for (const targetPath of targets) {
    removedFiles += removeTree(publicAudioRoot, targetPath);
  }

  fs.mkdirSync(path.resolve(publicAudioRoot, "tracks"), { recursive: true });
  fs.mkdirSync(path.resolve(publicAudioRoot, "hls"), { recursive: true });

  const leftovers = targets
    .map((targetPath) => ({ targetPath, count: countFiles(targetPath) }))
    .filter(({ count }) => count > 0);
  if (leftovers.length) {
    throw new Error(
      `Public music media cleanup left files behind: ${leftovers
        .map(({ targetPath, count }) => `${targetPath}=${count}`)
        .join(", ")}`
    );
  }

  return removedFiles;
}

async function main() {
  console.log("Clearing PostgreSQL music catalog...");
  const deletedRows = await clearDatabase();
  console.log(
    `Database cleared: ${Object.entries(deletedRows)
      .map(([tableName, count]) => `${tableName}=${count}`)
      .join(", ")}`
  );

  const removedMediaFiles = removePublicMusicMedia();
  console.log(`Removed public music media files: ${removedMediaFiles}`);

  const snapshot = await exportPortableSnapshot();
  console.log(
    `Portable snapshot refreshed: tables=${snapshot.tableCount}, rows=${snapshot.rowCount}, mediaFiles=${snapshot.mediaFileCount}`
  );
}

main().catch((error) => {
  console.error("Music content cleanup failed:", error);
  process.exitCode = 1;
});
