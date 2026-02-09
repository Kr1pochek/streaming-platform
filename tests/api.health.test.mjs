import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp } from "../server/app.js";
import { closePool } from "../server/services/catalogService.js";

test("GET /api/health returns ok:true", async (t) => {
  const app = createApp();
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

  const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test.after(async () => {
  await closePool();
});
