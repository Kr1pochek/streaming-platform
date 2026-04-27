import assert from "node:assert/strict";
import test from "node:test";
import {
  findArtistIdByName,
  findArtistIdByTrackArtist,
  resolveArtistIds,
  resolveArtistLine,
} from "../src/utils/artistRouting.js";

const artists = [
  { id: "a-1", name: "Nova Echo" },
  { id: "a-2", name: "R. Pulse" },
  { id: "a-3", name: "Luna" },
];

test("findArtistIdByName resolves id case-insensitively", () => {
  assert.equal(findArtistIdByName(" nova echo ", artists), "a-1");
  assert.equal(findArtistIdByName("r. pulse", artists), "a-2");
  assert.equal(findArtistIdByName("unknown", artists), null);
});

test("findArtistIdByTrackArtist picks first matched artist", () => {
  assert.equal(findArtistIdByTrackArtist("Unknown, R. Pulse", artists), "a-2");
  assert.equal(findArtistIdByTrackArtist("Nope, Nada", artists), null);
});

test("resolveArtistLine supports feat separators", () => {
  assert.deepEqual(resolveArtistLine("Nova Echo feat. R. Pulse", artists), [
    { name: "Nova Echo", id: "a-1" },
    { name: "R. Pulse", id: "a-2" },
  ]);
});

test("resolveArtistLine maps names to ids", () => {
  assert.deepEqual(resolveArtistLine("Nova Echo, Unknown, Luna", artists), [
    { name: "Nova Echo", id: "a-1" },
    { name: "Unknown", id: null },
    { name: "Luna", id: "a-3" },
  ]);
});

test("resolveArtistIds returns unique ids in order", () => {
  assert.deepEqual(resolveArtistIds("Nova Echo, R. Pulse, Nova Echo", artists), ["a-1", "a-2"]);
});

test("resolveArtistIds deduplicates artists from feat and comma formats", () => {
  assert.deepEqual(resolveArtistIds("Nova Echo feat. R. Pulse, Nova Echo", artists), ["a-1", "a-2"]);
});
