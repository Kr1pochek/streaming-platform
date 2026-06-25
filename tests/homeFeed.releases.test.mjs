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

test("GET /api/home-feed exposes latest published releases for anonymous users", async (t) => {
  const server = await startServer({
    nowProvider: () => NOW_MS,
    catalogFetcher: async () => ({
      playlists: [],
      tracks: [
        {
          id: "track-1",
          title: "First Track",
          artist: "Artist One",
          durationSec: 180,
          cover: "linear-gradient(135deg, #111, #333)",
        },
      ],
      trackMap: {
        "track-1": {
          id: "track-1",
          title: "First Track",
          artist: "Artist One",
          durationSec: 180,
          cover: "linear-gradient(135deg, #111, #333)",
        },
      },
      artists: [{ id: "artist-1", name: "Artist One" }],
      releases: [
        {
          id: "release-1",
          artistId: "artist-1",
          title: "New Era",
          type: "single",
          year: 2026,
          cover: "linear-gradient(135deg, #111, #333)",
          publishedAt: NOW_MS - DAY_MS,
          trackIds: ["track-1"],
        },
      ],
    }),
  });
  t.after(server.stop);

  const response = await fetch(`${server.baseUrl}/api/home-feed`);
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.equal(payload.releaseNotifications.length, 1);
  assert.equal(payload.releaseNotifications[0].releaseId, "release-1");
  assert.deepEqual(payload.releaseNotifications[0].trackIds, ["track-1"]);
  assert.equal(payload.releaseNotifications[0].artistName, "Artist One");
  assert.equal(payload.releaseNotificationWindowDays, 14);
});

test("GET /api/home-feed hides releases outside the home freshness window", async (t) => {
  const server = await startServer({
    nowProvider: () => NOW_MS,
    homeReleaseVisibilityDays: 14,
    catalogFetcher: async () => ({
      playlists: [],
      tracks: [
        {
          id: "track-1",
          title: "First Track",
          artist: "Artist One",
          durationSec: 180,
          cover: "linear-gradient(135deg, #111, #333)",
        },
      ],
      trackMap: {
        "track-1": {
          id: "track-1",
          title: "First Track",
          artist: "Artist One",
          durationSec: 180,
          cover: "linear-gradient(135deg, #111, #333)",
        },
      },
      artists: [{ id: "artist-1", name: "Artist One" }],
      releases: [
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
      ],
    }),
  });
  t.after(server.stop);

  const response = await fetch(`${server.baseUrl}/api/home-feed`);
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.deepEqual(payload.releaseNotifications, []);
});

test("GET /api/home-feed does not truncate visible release notifications", async (t) => {
  const releases = Array.from({ length: 10 }, (_item, index) => ({
    id: `release-${index + 1}`,
    artistId: "artist-1",
    title: `Release ${index + 1}`,
    type: "single",
    year: 2026,
    cover: "linear-gradient(135deg, #111, #333)",
    publishedAt: NOW_MS - (index + 1) * 1000,
    trackIds: ["track-1"],
  }));
  const server = await startServer({
    nowProvider: () => NOW_MS,
    catalogFetcher: async () => ({
      playlists: [],
      tracks: [
        {
          id: "track-1",
          title: "First Track",
          artist: "Artist One",
          durationSec: 180,
          cover: "linear-gradient(135deg, #111, #333)",
        },
      ],
      trackMap: {
        "track-1": {
          id: "track-1",
          title: "First Track",
          artist: "Artist One",
          durationSec: 180,
          cover: "linear-gradient(135deg, #111, #333)",
        },
      },
      artists: [{ id: "artist-1", name: "Artist One" }],
      releases,
    }),
  });
  t.after(server.stop);

  const response = await fetch(`${server.baseUrl}/api/home-feed`);
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.equal(payload.releaseNotifications.length, releases.length);
  assert.deepEqual(
    payload.releaseNotifications.map((release) => release.releaseId),
    releases.map((release) => release.id)
  );
});
