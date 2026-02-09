import assert from "node:assert/strict";
import test from "node:test";
import {
  findArtistIdByName,
  findArtistIdByTrackArtist,
  resolveArtistIds,
  resolveArtistLine,
} from "../src/utils/artistRouting.js";

const artists = [
  { id: "a-1", name: "Joji" },
  { id: "a-2", name: "J. Cole" },
  { id: "a-3", name: "СИМОЧКА" },
];

test("findArtistIdByName resolves id case-insensitively", () => {
  assert.equal(findArtistIdByName(" joji ", artists), "a-1");
  assert.equal(findArtistIdByName("j. cole", artists), "a-2");
  assert.equal(findArtistIdByName("unknown", artists), null);
});

test("findArtistIdByTrackArtist picks first matched artist", () => {
  assert.equal(findArtistIdByTrackArtist("Unknown, J. Cole", artists), "a-2");
  assert.equal(findArtistIdByTrackArtist("Nope, Nada", artists), null);
});

test("resolveArtistLine maps names to ids", () => {
  assert.deepEqual(resolveArtistLine("Joji, Unknown, СИМОЧКА", artists), [
    { name: "Joji", id: "a-1" },
    { name: "Unknown", id: null },
    { name: "СИМОЧКА", id: "a-3" },
  ]);
});

test("resolveArtistIds returns unique ids in order", () => {
  assert.deepEqual(resolveArtistIds("Joji, J. Cole, Joji", artists), ["a-1", "a-2"]);
});
