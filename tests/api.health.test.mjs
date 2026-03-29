import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp } from "../server/app.js";
import { closePool } from "../server/services/catalogService.js";

async function startTestServer(app, t) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

test("GET /api/health returns ok:true", async (t) => {
  const { baseUrl } = await startTestServer(createApp(), t);

  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("GET /api/ready returns database up when readiness succeeds", async (t) => {
  const { baseUrl } = await startTestServer(
    createApp({
      apiRouterOptions: {
        readinessCheck: async () => true,
      },
    }),
    t
  );

  const response = await fetch(`${baseUrl}/api/ready`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, database: "up" });
});

test("GET /api/ready returns 503 when readiness fails", async (t) => {
  const { baseUrl } = await startTestServer(
    createApp({
      apiRouterOptions: {
        readinessCheck: async () => {
          throw new Error("database down");
        },
      },
    }),
    t
  );

  const response = await fetch(`${baseUrl}/api/ready`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, database: "down" });
});

test.after(async () => {
  await closePool();
});
