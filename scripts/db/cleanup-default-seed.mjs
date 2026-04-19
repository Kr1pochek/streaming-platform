import process from "node:process";
import {
  assertCatalogSchemaReady,
  cleanupDefaultCatalogSeed,
  closePool,
  pool,
} from "../../server/services/catalogService.js";

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
    `catalog summary: artists=${Number(row.artists_count ?? 0)}, tracks=${Number(row.tracks_count ?? 0)}, playlists=${Number(
      row.playlists_count ?? 0
    )}, releases=${Number(row.releases_count ?? 0)}`
  );
}

async function main() {
  await assertCatalogSchemaReady();
  const cleanup = await cleanupDefaultCatalogSeed();
  console.log(
    `default catalog cleanup: releases=${cleanup.deletedReleases}, playlists=${cleanup.deletedPlaylists}, tracks=${cleanup.deletedTracks}, artists=${cleanup.deletedArtists}`
  );
  await printSummary();
}

main()
  .catch((error) => {
    console.error("Default catalog cleanup failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
