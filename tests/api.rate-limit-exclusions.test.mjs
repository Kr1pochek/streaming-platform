import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import test from "node:test";
import { createApp } from "../server/app.js";

const TRACK_ID = "test-track";
const AUDIO_URL = "/api/media/tracks/test-track.mp3";

function createTempAudioFile(content) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "api-rate-limit-test-"));
  const filePath = path.join(directory, "sample.mp3");
  fs.writeFileSync(filePath, Buffer.from(content));
  return { directory, filePath };
}

function localResolverFromFile(filePath, expectedAudioUrl = AUDIO_URL) {
  return (audioUrl) => (audioUrl === expectedAudioUrl ? filePath : null);
}

async function startServer(app) {
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

test("global API rate limit skips playback, stream, and player-state routes", async (t) => {
  const { directory, filePath } = createTempAudioFile("abcdefghijklmnopqrstuvwxyz");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const app = createApp({
    apiRouterOptions: {
      catalogFetcher: async () => ({
        trackMap: {
          [TRACK_ID]: {
            id: TRACK_ID,
            title: "Test Track",
            artist: "Test Artist",
            audioUrl: AUDIO_URL,
          },
        },
      }),
      mediaPathResolver: localResolverFromFile(filePath),
    },
    apiRateLimitOptions: {
      windowMs: 60_000,
      max: 1,
      maxEntries: 100,
      cleanupIntervalMs: 1_000,
    },
  });

  const server = await startServer(app);
  t.after(server.stop);

  const healthResponse = await fetch(`${server.baseUrl}/api/health`);
  assert.equal(healthResponse.status, 200);

  const limitedResponse = await fetch(`${server.baseUrl}/api/auth/me`);
  assert.equal(limitedResponse.status, 429);

  const playbackResponse = await fetch(`${server.baseUrl}/api/playback/${TRACK_ID}`);
  assert.equal(playbackResponse.status, 200);
  const playbackPayload = await playbackResponse.json();
  assert.ok(String(playbackPayload.streamUrl ?? "").startsWith(`/api/stream/${TRACK_ID}`));

  const streamResponse = await fetch(`${server.baseUrl}/api/stream/${TRACK_ID}`, {
    headers: { Range: "bytes=0-9" },
  });
  assert.equal(streamResponse.status, 206);

  const playerStateResponse = await fetch(`${server.baseUrl}/api/me/player-state`);
  assert.equal(playerStateResponse.status, 401);
});
