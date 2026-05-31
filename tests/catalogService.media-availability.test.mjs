import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import {
  buildSearchQueryVariants,
  isTrackAudioAvailable,
  mapTrackRow,
  rankFuzzySearchItems,
  sanitizeTrackTags,
} from "../server/services/catalogService.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const hlsFixtureDirectory = path.resolve(currentDirectory, "../public/audio/hls/test-local-track");
const hlsFixtureManifest = path.join(hlsFixtureDirectory, "master.m3u8");

function removeHlsFixture() {
  if (fs.existsSync(hlsFixtureManifest)) {
    fs.unlinkSync(hlsFixtureManifest);
  }
  if (fs.existsSync(hlsFixtureDirectory) && !fs.readdirSync(hlsFixtureDirectory).length) {
    fs.rmdirSync(hlsFixtureDirectory);
  }
}

before(() => {
  fs.mkdirSync(hlsFixtureDirectory, { recursive: true });
  fs.writeFileSync(hlsFixtureManifest, "#EXTM3U\n", "utf8");
});

after(() => {
  removeHlsFixture();
});

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

test("sanitizeTrackTags canonicalizes Russian genre tags to English", () => {
  assert.deepEqual(sanitizeTrackTags(["трэп", "трэп-метал", "рок", "trap"]), ["trap", "trap metal", "rock"]);
});

test("buildSearchQueryVariants includes canonical genre spellings", () => {
  assert.deepEqual(buildSearchQueryVariants("трэп-металл"), ["трэп-металл", "трэп металл", "trap metal"]);
});

test("rankFuzzySearchItems keeps close genre matches for typo queries", () => {
  const [match] = rankFuzzySearchItems(
    [
      { id: "trap-metal-track", tags: ["trap metal"] },
      { id: "ambient-track", tags: ["ambient"] },
    ],
    "трэп-металлл",
    (item) => item.tags,
    2
  );

  assert.equal(match.id, "trap-metal-track");
});

test("rankFuzzySearchItems does not match compound genres by one shared token", () => {
  const matches = rankFuzzySearchItems(
    [
      { id: "trap-metal-track", title: "Trap Metal Anthem", tags: ["trap metal"] },
      { id: "metallic-track", title: "Metallic Smell", tags: ["metal"] },
      { id: "death-track", title: "Death March", tags: ["industrial"] },
      { id: "alternative-track", title: "A Secret Place", tags: ["alternative"] },
    ],
    "death metal",
    (item) => [item.title, ...(item.tags ?? [])],
    4
  );

  assert.deepEqual(matches.map((item) => item.id), []);
});

test("rankFuzzySearchItems keeps exact compound genre matches ahead of shared-token genres", () => {
  const matches = rankFuzzySearchItems(
    [
      { id: "trap-metal-track", title: "Trap Metal Anthem", tags: ["trap metal"] },
      { id: "death-metal-track", title: "Funeral Blast", tags: ["death metal"] },
      { id: "metallic-track", title: "Metallic Smell", tags: ["metal"] },
    ],
    "death metal",
    (item) => [item.title, ...(item.tags ?? [])],
    4
  );

  assert.deepEqual(matches.map((item) => item.id), ["death-metal-track"]);
});
