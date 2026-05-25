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

test("same-origin API request is allowed even when CORS_ORIGINS targets Vite dev server", async (t) => {
  const server = await startServer();
  t.after(server.stop);

  const response = await fetch(`${server.baseUrl}/api/health`, {
    headers: {
      Origin: server.baseUrl,
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), server.baseUrl);
});

test("forwarded same-origin API request is allowed behind a tunnel", async (t) => {
  const server = await startServer();
  t.after(server.stop);

  const publicOrigin = "https://example.ngrok-free.dev";
  const response = await fetch(`${server.baseUrl}/api/health`, {
    headers: {
      Origin: publicOrigin,
      "X-Forwarded-Host": "example.ngrok-free.dev",
      "X-Forwarded-Proto": "https",
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), publicOrigin);
});

test("non-API routes are not blocked by API CORS policy", async (t) => {
  const server = await startServer();
  t.after(server.stop);

  const response = await fetch(`${server.baseUrl}/some-client-route`, {
    headers: {
      Origin: "http://example.com",
    },
  });

  assert.notEqual(response.status, 500);
});
