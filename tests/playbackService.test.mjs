import assert from "node:assert/strict";
import test from "node:test";
import {
  createPlaybackSignature,
  createSignedStreamUrl,
  getEmbeddedPlaybackUrlTtlMs,
  getPlaybackUrlTtlMs,
  isPlaybackSigningRequired,
  shouldEmbedSignedPlaybackUrl,
  validateSignedPlaybackRequest,
} from "../server/services/playbackService.js";

test("createSignedStreamUrl returns unsigned URL when secret is missing", () => {
  const descriptor = createSignedStreamUrl("track-1", {
    basePath: "/api/stream",
    nowMs: 1_000,
    ttlMs: 5_000,
    secret: "",
  });

  assert.deepEqual(descriptor, {
    url: "/api/stream/track-1",
    expiresAt: null,
    signed: false,
  });
});

test("createSignedStreamUrl signs URL when secret is configured", () => {
  const descriptor = createSignedStreamUrl("track 1", {
    basePath: "/api/stream/",
    nowMs: 10_000,
    ttlMs: 5_000,
    secret: "secret-value",
  });

  assert.equal(descriptor.signed, true);
  assert.equal(descriptor.expiresAt, 15_000);
  assert.ok(descriptor.url.startsWith("/api/stream/track%201?"));

  const params = new URLSearchParams(descriptor.url.split("?")[1]);
  assert.equal(params.get("exp"), "15000");
  assert.equal(
    params.get("sig"),
    createPlaybackSignature("track 1", 15_000, "secret-value")
  );
});

test("validateSignedPlaybackRequest accepts valid token", () => {
  const expiresAt = 30_000;
  const signature = createPlaybackSignature("track-1", expiresAt, "secret");
  const result = validateSignedPlaybackRequest({
    trackId: "track-1",
    signature,
    expiresAt,
    nowMs: 10_000,
    required: true,
    secret: "secret",
  });

  assert.equal(result.ok, true);
  assert.equal(result.expiresAt, expiresAt);
});

test("validateSignedPlaybackRequest rejects missing token when signing is required", () => {
  const result = validateSignedPlaybackRequest({
    trackId: "track-1",
    required: true,
    secret: "secret",
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
});

test("validateSignedPlaybackRequest rejects expired token", () => {
  const expiresAt = 9_000;
  const signature = createPlaybackSignature("track-1", expiresAt, "secret");
  const result = validateSignedPlaybackRequest({
    trackId: "track-1",
    signature,
    expiresAt,
    nowMs: 10_000,
    required: true,
    secret: "secret",
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.message, "Signed playback token has expired.");
});

test("validateSignedPlaybackRequest rejects invalid signature", () => {
  const result = validateSignedPlaybackRequest({
    trackId: "track-1",
    signature: "bad-token",
    expiresAt: 50_000,
    nowMs: 10_000,
    required: true,
    secret: "secret",
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.message, "Signed playback token is invalid.");
});

test("validateSignedPlaybackRequest allows unsigned request when signing is optional", () => {
  const result = validateSignedPlaybackRequest({
    trackId: "track-1",
    required: false,
    secret: "",
  });

  assert.deepEqual(result, { ok: true });
});

test("playback env helpers parse boolean and ttl values", () => {
  assert.equal(isPlaybackSigningRequired({ PLAYBACK_REQUIRE_SIGNED: "yes" }), true);
  assert.equal(isPlaybackSigningRequired({ PLAYBACK_REQUIRE_SIGNED: "0" }), false);
  assert.equal(shouldEmbedSignedPlaybackUrl({ PLAYBACK_EMBED_SIGNED_URL: "off" }), false);
  assert.equal(shouldEmbedSignedPlaybackUrl({ PLAYBACK_EMBED_SIGNED_URL: "1" }), true);
  assert.equal(getPlaybackUrlTtlMs({ PLAYBACK_URL_TTL_MS: "1234" }), 1234);
  assert.equal(getPlaybackUrlTtlMs({ PLAYBACK_URL_TTL_MS: "oops" }), 15 * 60 * 1000);
  assert.equal(getEmbeddedPlaybackUrlTtlMs({ PLAYBACK_EMBED_URL_TTL_MS: "-1" }), 6 * 60 * 60 * 1000);
});
