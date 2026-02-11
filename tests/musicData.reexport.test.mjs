import assert from "node:assert/strict";
import test from "node:test";
import * as legacyMusicData from "../src/data/musicData.js";
import * as sharedMusicData from "../shared/musicData.js";

test("src/data/musicData.js re-exports shared music data bindings", () => {
  const sharedKeys = Object.keys(sharedMusicData).sort();
  const legacyKeys = Object.keys(legacyMusicData).sort();
  assert.deepEqual(legacyKeys, sharedKeys);

  for (const key of sharedKeys) {
    assert.equal(
      legacyMusicData[key],
      sharedMusicData[key],
      `Expected export "${key}" to point at shared binding`
    );
  }
});
