import assert from "node:assert/strict";
import test from "node:test";
import { buildCatalogState, buildSearchCollections } from "../server/services/feedService.js";

test("buildCatalogState reports sparse mode and visible counters", () => {
  const state = buildCatalogState({
    tracks: [{ id: "t-1" }, { id: "t-2" }],
    playlists: [
      { id: "sys-catalog-now", trackIds: ["t-1", "t-2"], isSystem: true },
      { id: "pl-public", trackIds: ["t-1"] },
      { id: "pl-empty", trackIds: [] },
    ],
  });

  assert.deepEqual(state, {
    visibleTracks: 2,
    visiblePlaylists: 2,
    systemPlaylists: 1,
    sparseCatalog: true,
  });
});

test("buildSearchCollections mixes playlist and artist shortcuts for a compact catalog", () => {
  const collections = buildSearchCollections({
    playlists: [
      {
        id: "sys-catalog-now",
        title: "Сейчас в каталоге",
        subtitle: "2 трека",
        cover: "linear-gradient(135deg, #111, #222)",
        trackIds: ["t-1", "t-2"],
        isSystem: true,
      },
      {
        id: "pl-public",
        title: "Публичный плейлист",
        subtitle: "Подборка",
        cover: "linear-gradient(135deg, #333, #444)",
        trackIds: ["t-1"],
      },
    ],
    tracks: [
      {
        id: "t-1",
        title: "Track One",
        artist: "Artist One",
        cover: "linear-gradient(135deg, #555, #666)",
      },
      {
        id: "t-2",
        title: "Track Two",
        artist: "Artist One",
        cover: "linear-gradient(135deg, #777, #888)",
      },
    ],
    artists: [{ id: "a-artist-one", name: "Artist One" }],
  });

  assert.ok(collections.length >= 2);
  assert.ok(collections.length <= 5);
  assert.equal(collections[0].type, "playlist");
  assert.equal(collections[0].targetId, "sys-catalog-now");
  assert.equal(collections.some((item) => item.type === "artist" && item.targetId === "a-artist-one"), true);
  assert.equal(new Set(collections.map((item) => item.id)).size, collections.length);
  assert.equal(collections.every((item) => item.badge === undefined), true);
});
