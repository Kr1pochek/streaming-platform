import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp } from "../server/app.js";

async function startServer() {
  const app = createApp();
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

test("GET /api/auth/me requires authentication", async (t) => {
  const server = await startServer();
  t.after(server.stop);

  const response = await fetch(`${server.baseUrl}/api/auth/me`);
  assert.equal(response.status, 401);
  const payload = await response.json();
  assert.equal(typeof payload.message, "string");
});

test("GET /api/me/player-state requires authentication", async (t) => {
  const server = await startServer();
  t.after(server.stop);

  const response = await fetch(`${server.baseUrl}/api/me/player-state`);
  assert.equal(response.status, 401);
  const payload = await response.json();
  assert.equal(typeof payload.message, "string");
});

test("GET /api/search without query returns empty payload with pagination", async (t) => {
  const server = await startServer();
  t.after(server.stop);

  const response = await fetch(`${server.baseUrl}/api/search`);
  assert.equal(response.status, 200);
  const payload = await response.json();

  assert.deepEqual(payload.tracks, []);
  assert.deepEqual(payload.playlists, []);
  assert.deepEqual(payload.artists, []);
  assert.deepEqual(payload.albums, []);
  assert.deepEqual(payload.pagination, {
    limit: 12,
    offset: 0,
    hasMore: false,
    nextOffset: null,
  });
});

test("POST /api/auth/login is rate-limited", async (t) => {
  const server = await startServer();
  t.after(server.stop);

  const attempt = () =>
    fetch(`${server.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

  let firstStatus = null;
  let secondStatus = null;
  let lastStatus = null;
  for (let index = 0; index < 21; index += 1) {
    const response = await attempt();
    if (index === 0) {
      firstStatus = response.status;
    }
    if (index === 1) {
      secondStatus = response.status;
    }
    lastStatus = response.status;
  }

  assert.equal(firstStatus, 400);
  assert.equal(secondStatus, 400);
  assert.equal(lastStatus, 429);
});
