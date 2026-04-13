import assert from "node:assert/strict";
import test from "node:test";
import {
  isTrackAudioAvailable,
  mapTrackRow,
} from "../server/services/catalogService.js";

test("isTrackAudioAvailable returns true for existing local media", () => {
  assert.equal(isTrackAudioAvailable("danseside", "/api/media/tracks/danseside.mp3"), true);
});

test("isTrackAudioAvailable returns false for missing local media without HLS", () => {
  assert.equal(isTrackAudioAvailable("city-rain", "/api/media/tracks/city-rain.mp3"), false);
});

test("mapTrackRow exposes HLS metadata for available tracks", () => {
  const track = mapTrackRow({
    id: "danseside",
    title: "DANCESIDE",
    artist: "Joji",
    durationSec: 129,
    explicit: true,
    cover: "linear-gradient(135deg, #3b1112 0%, #8a2f2a 55%, #111112 100%)",
    audioUrl: "/api/media/tracks/danseside.mp3",
    tags: ["trending"],
  });

  assert.equal(track.rawAudioUrl, "/api/media/tracks/danseside.mp3");
  assert.equal(track.isLocalAudio, true);
  assert.equal(track.hlsUrl, "/api/media/hls/danseside/master.m3u8");
  assert.equal(track.audioUrl, "/api/stream/danseside");
});
