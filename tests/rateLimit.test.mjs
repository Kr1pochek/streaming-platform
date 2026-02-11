import assert from "node:assert/strict";
import test from "node:test";
import { createRateLimiter, resolveRequestIp } from "../server/middleware/rateLimit.js";

function invokeMiddleware(middleware, req) {
  return new Promise((resolve) => {
    middleware(req, {}, (error) => {
      resolve(error ?? null);
    });
  });
}

test("resolveRequestIp falls back to socket remoteAddress", () => {
  const req = { socket: { remoteAddress: "127.0.0.2" } };
  assert.equal(resolveRequestIp(req), "127.0.0.2");
});

test("createRateLimiter blocks after max requests per key", async () => {
  const limiter = createRateLimiter({
    windowMs: 1_000,
    max: 2,
    keyResolver: (req) => req.key,
  });
  const req = { key: "same-key" };

  assert.equal(await invokeMiddleware(limiter, req), null);
  assert.equal(await invokeMiddleware(limiter, req), null);
  const error = await invokeMiddleware(limiter, req);
  assert.equal(error?.status, 429);
});

test("createRateLimiter resets counter after window", async () => {
  const limiter = createRateLimiter({
    windowMs: 20,
    max: 1,
    keyResolver: (req) => req.key,
  });
  const req = { key: "ephemeral-key" };

  assert.equal(await invokeMiddleware(limiter, req), null);
  assert.equal((await invokeMiddleware(limiter, req))?.status, 429);

  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(await invokeMiddleware(limiter, req), null);
});

test("createRateLimiter evicts old keys when maxEntries is reached", async () => {
  const limiter = createRateLimiter({
    windowMs: 10_000,
    max: 1,
    maxEntries: 2,
    cleanupIntervalMs: 10_000,
    keyResolver: (req) => req.key,
  });

  assert.equal(await invokeMiddleware(limiter, { key: "a" }), null);
  assert.equal(await invokeMiddleware(limiter, { key: "b" }), null);
  assert.equal(await invokeMiddleware(limiter, { key: "c" }), null);

  // If "a" was evicted due to maxEntries limit, this request is treated as a new bucket.
  assert.equal(await invokeMiddleware(limiter, { key: "a" }), null);
});
