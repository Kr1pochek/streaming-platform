import fs from "node:fs";
import process from "node:process";
import {
  closePool,
  pool,
  resolveMediaFilePath,
} from "../../server/services/catalogService.js";
import {
  mediaPublicUrlForRelativePath,
  mediaStorageDriver,
  persistMediaFile,
  relativePathFromLocalMediaUrl,
} from "../../server/services/mediaStorageService.js";

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const driver = mediaStorageDriver(process.env);
  if (driver !== "s3") {
    throw new Error("MEDIA_STORAGE_DRIVER must be set to \"s3\" for this migration.");
  }

  const { rows } = await pool.query(`
    select id, audio_url as "audioUrl"
    from tracks
    order by id;
  `);

  let migrated = 0;
  let skipped = 0;
  let missing = 0;

  for (const row of rows) {
    const trackId = String(row.id ?? "").trim();
    const audioUrl = String(row.audioUrl ?? "").trim();
    if (!audioUrl) {
      skipped += 1;
      continue;
    }

    if (!audioUrl.startsWith("/api/media/")) {
      skipped += 1;
      continue;
    }

    const localPath = resolveMediaFilePath(audioUrl);
    if (!localPath || !fs.existsSync(localPath)) {
      console.log(`[missing] ${trackId}: ${audioUrl}`);
      missing += 1;
      continue;
    }

    const relativePath = relativePathFromLocalMediaUrl(audioUrl);
    if (!relativePath) {
      skipped += 1;
      continue;
    }

    if (args.dryRun) {
      console.log(`[dry-run] ${trackId}: ${audioUrl} -> ${mediaPublicUrlForRelativePath(relativePath)}`);
      migrated += 1;
      continue;
    }

    const persisted = await persistMediaFile({
      sourceFilePath: localPath,
      relativePath,
      contentType: "audio/mpeg",
      env: process.env,
    });
    await pool.query(
      `
      update tracks
      set audio_url = $2
      where id = $1;
    `,
      [trackId, persisted.publicUrl]
    );
    console.log(`[migrated] ${trackId}: ${persisted.publicUrl}`);
    migrated += 1;
  }

  console.log(`tracks total: ${rows.length}`);
  console.log(`migrated: ${migrated}${args.dryRun ? " (dry-run)" : ""}`);
  console.log(`skipped: ${skipped}`);
  console.log(`missing local files: ${missing}`);
  if (missing > 0) {
    process.exitCode = 2;
  }
}

main()
  .catch((error) => {
    console.error("Audio migration failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
