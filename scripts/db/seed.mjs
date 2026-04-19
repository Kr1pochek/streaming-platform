import process from "node:process";
import {
  assertCatalogSchemaReady,
  closePool,
  pool,
  runCatalogSeed,
  validateCatalogAudioFiles,
} from "../../server/services/catalogService.js";
import { ensureSeedUser } from "../../server/services/authService.js";

async function printSummary() {
  const { rows } = await pool.query(`
    select
      (select count(*)::int from artists) as artists_count,
      (select count(*)::int from tracks) as tracks_count,
      (select count(*)::int from playlists) as playlists_count,
      (select count(*)::int from releases) as releases_count;
  `);

  const row = rows[0] ?? {};
  console.log(
    `seed summary: artists=${Number(row.artists_count ?? 0)}, tracks=${Number(row.tracks_count ?? 0)}, playlists=${Number(
      row.playlists_count ?? 0
    )}, releases=${Number(row.releases_count ?? 0)}`
  );
}

async function main() {
  await assertCatalogSchemaReady();
  const seedResult = await runCatalogSeed();
  const seedUser = await ensureSeedUser();
  if (seedResult.defaultCatalogSeedEnabled) {
    console.log("default catalog seed: enabled");
  } else {
    console.log("default catalog seed: skipped (ENABLE_DEFAULT_CATALOG_SEED=false)");
  }
  await printSummary();
  const validation = await validateCatalogAudioFiles();
  const warningSuffix = validation.hasWarnings
    ? ` (${validation.missingFiles.length} local file warnings, unavailable tracks are hidden from the user catalog)`
    : "";
  console.log(`audio catalog checked for ${validation.totalTracks} tracks${warningSuffix}`);
  if (seedUser) {
    console.log(`seed user: ${seedUser.username}${seedUser.isAdmin ? " (admin)" : ""}`);
  } else {
    console.log("seed user: skipped (SEED_USERNAME/SEED_PASSWORD are not set)");
  }
}

main()
  .catch((error) => {
    console.error("Seeding failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
