import assert from "node:assert/strict";
import test from "node:test";
import {
  SYSTEM_PLAYLIST_ID_PREFIX,
  buildCatalogSupplementalPlaylists,
} from "../server/services/catalogService.js";

function createTrack(id, title, artist, createdAt, cover = "linear-gradient(135deg, #20252b 0%, #35424f 100%)") {
  return {
    id,
    title,
    artist,
    cover,
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
      createTrack("night-one", "Night One", "Night Echo", 300),
      createTrack("night-two", "Night Two", "Night Echo", 200),
      createTrack("night-three", "Night Three", "Other Artist", 100),
    ],
    existingPlaylists: [],
  });

  assert.ok(playlists.some((playlist) => playlist.id === `${SYSTEM_PLAYLIST_ID_PREFIX}artist-focus`));
});

test("buildCatalogSupplementalPlaylists keeps artist focus cover on that artist", () => {
  const slipknotCover = "linear-gradient(135deg, #111 0%, #700 100%)";
  const otherCover = "linear-gradient(135deg, #004 0%, #66f 100%)";
  const playlists = buildCatalogSupplementalPlaylists({
    tracks: [
      createTrack("slipknot-one", "Wait and Bleed", "Slipknot", 500, slipknotCover),
      createTrack("other-one", "Blue Noise", "Other Artist", 400, otherCover),
      createTrack("slipknot-two", "Duality", "Slipknot", 300, slipknotCover),
    ],
    existingPlaylists: [],
  });

  const focusPlaylist = playlists.find((playlist) => playlist.id === `${SYSTEM_PLAYLIST_ID_PREFIX}artist-focus`);

  assert.equal(focusPlaylist?.title, "Фокус: Slipknot");
  assert.equal(focusPlaylist?.cover, slipknotCover);
});

test("buildCatalogSupplementalPlaylists avoids duplicate covers for generated playlists", () => {
  const sharedCover = "linear-gradient(135deg, #111 0%, #333 100%)";
  const tracks = Array.from({ length: 9 }, (_, index) =>
    createTrack(`track-${index + 1}`, `Track ${index + 1}`, `Artist ${index + 1}`, 900 - index, sharedCover)
  );

  const playlists = buildCatalogSupplementalPlaylists({
    tracks,
    existingPlaylists: [],
  });
  const covers = playlists.map((playlist) => playlist.cover);

  assert.ok(covers.length >= 3);
  assert.equal(new Set(covers).size, covers.length);
});
