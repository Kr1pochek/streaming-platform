import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp } from "../server/app.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_MS = Date.UTC(2026, 4, 24);

async function startServer(apiRouterOptions = {}) {
  const app = createApp({ apiRouterOptions });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    stop: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

function buildArtistCatalog(releases) {
  const track = {
    id: "track-1",
    title: "First Track",
    artist: "Artist One",
    durationSec: 180,
    cover: "linear-gradient(135deg, #111, #333)",
    tags: ["rock"],
  };

  return {
    playlists: [],
    tracks: [track],
    trackMap: { [track.id]: track },
    artists: [{ id: "artist-1", name: "Artist One", followers: 0, listeners: 0 }],
    releases,
  };
}

test("GET /api/artists/:artistId exposes only fresh release cards", async (t) => {
  const server = await startServer({
    nowProvider: () => NOW_MS,
    homeReleaseVisibilityDays: 14,
    catalogFetcher: async () =>
      buildArtistCatalog([
        {
          id: "release-fresh",
          artistId: "artist-1",
          title: "Fresh Era",
          type: "single",
          year: 2026,
          cover: "linear-gradient(135deg, #111, #333)",
          publishedAt: NOW_MS - DAY_MS,
          trackIds: ["track-1"],
        },
        {
          id: "release-old",
          artistId: "artist-1",
          title: "Old Era",
          type: "album",
          year: 2025,
          cover: "linear-gradient(135deg, #111, #333)",
          publishedAt: NOW_MS - 15 * DAY_MS,
          trackIds: ["track-1"],
        },
      ]),
  });
  t.after(server.stop);

  const response = await fetch(`${server.baseUrl}/api/artists/artist-1`);
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.equal(payload.releaseCardWindowDays, 14);
  assert.equal(payload.latestRelease.id, "release-fresh");
  assert.deepEqual(
    payload.singles.map((release) => release.id),
    ["release-fresh"]
  );
  assert.deepEqual(payload.popularAlbums, []);
});

test("GET /api/artists/:artistId hides all release cards after the freshness window", async (t) => {
  const server = await startServer({
    nowProvider: () => NOW_MS,
    homeReleaseVisibilityDays: 14,
    catalogFetcher: async () =>
      buildArtistCatalog([
        {
          id: "release-old",
          artistId: "artist-1",
          title: "Old Era",
          type: "album",
          year: 2025,
          cover: "linear-gradient(135deg, #111, #333)",
          publishedAt: NOW_MS - 15 * DAY_MS,
          trackIds: ["track-1"],
        },
      ]),
  });
  t.after(server.stop);

  const response = await fetch(`${server.baseUrl}/api/artists/artist-1`);
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.equal(payload.latestRelease, null);
  assert.deepEqual(payload.popularAlbums, []);
  assert.deepEqual(payload.eps, []);
  assert.deepEqual(payload.singles, []);
});
