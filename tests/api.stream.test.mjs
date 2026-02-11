import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { createApiRouter } from "../server/routes/apiRoutes.js";
import { errorHandler } from "../server/middleware/errorHandler.js";

const TRACK_ID = "test-track";
const AUDIO_URL = "/api/media/tracks/test-track.mp3";

function createTempAudioFile(content) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "api-stream-test-"));
  const filePath = path.join(directory, "sample.mp3");
  fs.writeFileSync(filePath, Buffer.from(content));
  return { directory, filePath };
}

function localResolverFromFile(filePath, expectedAudioUrl = AUDIO_URL) {
  return (audioUrl) => (audioUrl === expectedAudioUrl ? filePath : null);
}

async function startServer({ trackMap, mediaPathResolver }) {
  const app = express();
  app.use(
    "/api",
    createApiRouter({
      catalogFetcher: async () => ({ trackMap }),
      mediaPathResolver,
    })
  );
  app.use(errorHandler);

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

test("GET /api/stream/:trackId returns 206 for ranged request", async (t) => {
  const payload = "abcdefghijklmnopqrstuvwxyz";
  const { directory, filePath } = createTempAudioFile(payload);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const server = await startServer({
    trackMap: {
      [TRACK_ID]: { id: TRACK_ID, audioUrl: AUDIO_URL },
    },
    mediaPathResolver: localResolverFromFile(filePath),
  });
  t.after(server.stop);

  const response = await fetch(`${server.baseUrl}/api/stream/${TRACK_ID}`, {
    headers: { Range: "bytes=0-9" },
  });

  assert.equal(response.status, 206);
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("content-range"), "bytes 0-9/26");
  assert.equal(response.headers.get("content-length"), "10");

  const body = Buffer.from(await response.arrayBuffer());
  assert.equal(body.toString("utf8"), "abcdefghij");
});

test("GET /api/stream/:trackId returns first chunk when range is missing", async (t) => {
  const payload = "abcdefghijklmnopqrstuvwxyz";
  const { directory, filePath } = createTempAudioFile(payload);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const server = await startServer({
    trackMap: {
      [TRACK_ID]: { id: TRACK_ID, audioUrl: AUDIO_URL },
    },
    mediaPathResolver: localResolverFromFile(filePath),
  });
  t.after(server.stop);

  const response = await fetch(`${server.baseUrl}/api/stream/${TRACK_ID}`);

  assert.equal(response.status, 206);
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("content-range"), "bytes 0-25/26");
  assert.equal(response.headers.get("content-length"), "26");
  assert.equal(Buffer.from(await response.arrayBuffer()).toString("utf8"), payload);
});

test("GET /api/stream/:trackId returns 416 for invalid range", async (t) => {
  const { directory, filePath } = createTempAudioFile("abcdefghijklmnopqrstuvwxyz");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const server = await startServer({
    trackMap: {
      [TRACK_ID]: { id: TRACK_ID, audioUrl: AUDIO_URL },
    },
    mediaPathResolver: localResolverFromFile(filePath),
  });
  t.after(server.stop);

  const response = await fetch(`${server.baseUrl}/api/stream/${TRACK_ID}`, {
    headers: { Range: "bytes=abc-def" },
  });

  assert.equal(response.status, 416);
  assert.equal(response.headers.get("content-range"), "bytes */26");
});

test("GET /api/stream/:trackId returns 404 for unknown track", async (t) => {
  const server = await startServer({
    trackMap: {},
    mediaPathResolver: () => null,
  });
  t.after(server.stop);

  const response = await fetch(`${server.baseUrl}/api/stream/${TRACK_ID}`);
  assert.equal(response.status, 404);
  const payload = await response.json();
  assert.equal(payload?.message, "Track not found.");
});

test("GET /api/stream/:trackId uses rawAudioUrl when audioUrl points to playback endpoint", async (t) => {
  const payload = "abcdefghijklmnopqrstuvwxyz";
  const { directory, filePath } = createTempAudioFile(payload);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const server = await startServer({
    trackMap: {
      [TRACK_ID]: {
        id: TRACK_ID,
        audioUrl: `/api/stream/${TRACK_ID}`,
        rawAudioUrl: AUDIO_URL,
      },
    },
    mediaPathResolver: localResolverFromFile(filePath),
  });
  t.after(server.stop);

  const response = await fetch(`${server.baseUrl}/api/stream/${TRACK_ID}`, {
    headers: { Range: "bytes=10-14" },
  });

  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 10-14/26");
  assert.equal(Buffer.from(await response.arrayBuffer()).toString("utf8"), "klmno");
});

test("GET /api/stream/:trackId rejects invalid signed token", async (t) => {
  const { directory, filePath } = createTempAudioFile("abcdefghijklmnopqrstuvwxyz");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const server = await startServer({
    trackMap: {
      [TRACK_ID]: { id: TRACK_ID, rawAudioUrl: AUDIO_URL, audioUrl: `/api/stream/${TRACK_ID}` },
    },
    mediaPathResolver: localResolverFromFile(filePath),
  });
  t.after(server.stop);

  const response = await fetch(
    `${server.baseUrl}/api/stream/${TRACK_ID}?sig=bad-token&exp=${Date.now() + 60_000}`
  );

  assert.equal(response.status, 403);
  const payload = await response.json();
  assert.equal(typeof payload?.message, "string");
  assert.ok(payload.message.toLowerCase().includes("invalid"));
});

test("GET /api/playback/:trackId returns playback metadata for local sources", async (t) => {
  const { directory, filePath } = createTempAudioFile("abcdefghijklmnopqrstuvwxyz");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const server = await startServer({
    trackMap: {
      [TRACK_ID]: {
        id: TRACK_ID,
        rawAudioUrl: AUDIO_URL,
        audioUrl: `/api/stream/${TRACK_ID}`,
      },
    },
    mediaPathResolver: localResolverFromFile(filePath),
  });
  t.after(server.stop);

  const response = await fetch(`${server.baseUrl}/api/playback/${TRACK_ID}`);
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.equal(payload.trackId, TRACK_ID);
  assert.ok(String(payload.streamUrl ?? "").startsWith(`/api/stream/${TRACK_ID}`));
  assert.equal(typeof payload.signed, "boolean");
  if (payload.signed) {
    assert.equal(typeof payload.expiresAt, "number");
    assert.ok(payload.streamUrl.includes("sig="));
    assert.ok(payload.streamUrl.includes("exp="));
  } else {
    assert.equal(payload.expiresAt, null);
  }
});

test("GET /api/playback/:trackId returns original URL for remote sources", async (t) => {
  const remoteAudioUrl = "https://cdn.example.com/track.mp3";
  const server = await startServer({
    trackMap: {
      [TRACK_ID]: {
        id: TRACK_ID,
        rawAudioUrl: remoteAudioUrl,
        audioUrl: remoteAudioUrl,
      },
    },
    mediaPathResolver: () => null,
  });
  t.after(server.stop);

  const response = await fetch(`${server.baseUrl}/api/playback/${TRACK_ID}`);
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.equal(payload.trackId, TRACK_ID);
  assert.equal(payload.streamUrl, remoteAudioUrl);
  assert.equal(payload.expiresAt, null);
  assert.equal(payload.signed, false);
  assert.ok(payload.hlsUrl === null || typeof payload.hlsUrl === "string");
});

test("GET /api/playback/:trackId returns 404 for unknown track", async (t) => {
  const server = await startServer({
    trackMap: {},
    mediaPathResolver: () => null,
  });
  t.after(server.stop);

  const response = await fetch(`${server.baseUrl}/api/playback/${TRACK_ID}`);
  assert.equal(response.status, 404);
  const payload = await response.json();
  assert.equal(payload?.message, "Track not found.");
});
