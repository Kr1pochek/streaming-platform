import assert from "node:assert/strict";
import test from "node:test";
import {
  isTrackAudioAvailable,
  mapTrackRow,
} from "../server/services/catalogService.js";

test("isTrackAudioAvailable returns true for existing local media", () => {
  assert.equal(isTrackAudioAvailable("demo-loop", "/api/media/demo-loop.wav"), true);
});

test("isTrackAudioAvailable returns false for missing local media without HLS", () => {
  assert.equal(isTrackAudioAvailable("missing-track", "/api/media/tracks/missing-track.mp3"), false);
});

test("mapTrackRow exposes HLS metadata for available tracks", () => {
  const track = mapTrackRow({
    id: "test-local-track",
    title: "Test Local Track",
    artist: "Artist One",
    durationSec: 129,
    explicit: true,
    cover: "linear-gradient(135deg, #3b1112 0%, #8a2f2a 55%, #111112 100%)",
    audioUrl: "/api/media/tracks/test-local-track.mp3",
    tags: ["trending"],
  });

  assert.equal(track.rawAudioUrl, "/api/media/tracks/test-local-track.mp3");
  assert.equal(track.isLocalAudio, true);
  assert.equal(track.hlsUrl, "/api/media/hls/test-local-track/master.m3u8");
  assert.equal(track.audioUrl, "/api/stream/test-local-track");
});
