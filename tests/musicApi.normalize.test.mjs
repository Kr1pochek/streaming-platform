import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAudienceCount } from "../src/api/musicApi.js";

test("normalizeAudienceCount keeps audience counters numeric and non-negative", () => {
  assert.equal(normalizeAudienceCount("42"), "42");
  assert.equal(normalizeAudienceCount("2,5"), "2");
  assert.equal(normalizeAudienceCount("-12"), "0");
  assert.equal(normalizeAudienceCount(null), "0");
});

test("normalizeAudienceCount expands shorthand audience counters", () => {
  assert.equal(normalizeAudienceCount("1K"), "1000");
  assert.equal(normalizeAudienceCount("2.5M"), "2500000");
  assert.equal(normalizeAudienceCount("3b"), "3000000000");
});
