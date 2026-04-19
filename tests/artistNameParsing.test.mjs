import assert from "node:assert/strict";
import test from "node:test";
import { splitArtistNames } from "../shared/artistNameParsing.js";

test("splitArtistNames supports commas and feat separators", () => {
  assert.deepEqual(splitArtistNames("Miyagi, Andy Panda"), ["Miyagi", "Andy Panda"]);
  assert.deepEqual(splitArtistNames("Miyagi feat. Andy Panda"), ["Miyagi", "Andy Panda"]);
  assert.deepEqual(splitArtistNames("Miyagi ft Andy Panda"), ["Miyagi", "Andy Panda"]);
  assert.deepEqual(splitArtistNames("Miyagi featuring Andy Panda"), ["Miyagi", "Andy Panda"]);
});
