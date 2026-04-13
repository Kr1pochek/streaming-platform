import assert from "node:assert/strict";
import test from "node:test";
import {
  SYSTEM_PLAYLIST_ID_PREFIX,
  buildCatalogSupplementalPlaylists,
} from "../server/services/catalogService.js";

function createTrack(id, title, artist, createdAt) {
  return {
    id,
    title,
    artist,
    cover: "linear-gradient(135deg, #20252b 0%, #35424f 100%)",
    createdAt,
  };
}

test("buildCatalogSupplementalPlaylists creates fallback playlists for sparse catalog", () => {
  const playlists = buildCatalogSupplementalPlaylists({
    tracks: [
      createTrack("soldier-of-cola", "Soldier of Cola", "Mish", 200),
      createTrack("danseside", "DANSeside", "Mish", 100),
    ],
    existingPlaylists: [],
  });

  assert.ok(playlists.length >= 1);
  assert.ok(playlists.every((playlist) => playlist.id.startsWith(SYSTEM_PLAYLIST_ID_PREFIX)));
  assert.ok(playlists.every((playlist) => playlist.isSystem === true));
  assert.ok(playlists.every((playlist) => playlist.trackIds.length >= 1));
});

test("buildCatalogSupplementalPlaylists skips duplicate track signatures already covered by existing playlists", () => {
  const playlists = buildCatalogSupplementalPlaylists({
    tracks: [
      createTrack("soldier-of-cola", "Soldier of Cola", "Mish", 200),
      createTrack("danseside", "DANSeside", "Mish", 100),
    ],
    existingPlaylists: [
      {
        id: "pl-existing",
        isCustom: false,
        isSystem: false,
        trackIds: ["soldier-of-cola", "danseside"],
      },
    ],
  });

  const signatures = playlists.map((playlist) => playlist.trackIds.join("|"));
  assert.ok(!signatures.includes("soldier-of-cola|danseside"));
});

test("buildCatalogSupplementalPlaylists adds artist focus playlist when one artist dominates sparse catalog", () => {
  const playlists = buildCatalogSupplementalPlaylists({
    tracks: [
      createTrack("night-one", "Night One", "Ari Vox", 300),
      createTrack("night-two", "Night Two", "Ari Vox", 200),
      createTrack("night-three", "Night Three", "Other Artist", 100),
    ],
    existingPlaylists: [],
  });

  assert.ok(playlists.some((playlist) => playlist.id === `${SYSTEM_PLAYLIST_ID_PREFIX}artist-focus`));
});
