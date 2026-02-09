import assert from "node:assert/strict";
import test from "node:test";
import { formatDuration, formatDurationClock } from "../src/utils/formatters.js";

test("formatDuration returns mm:ss", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(65), "1:05");
  assert.equal(formatDuration(3599), "59:59");
});

test("formatDuration handles invalid input", () => {
  assert.equal(formatDuration(-1), "0:00");
  assert.equal(formatDuration(Number.NaN), "0:00");
  assert.equal(formatDuration(Infinity), "0:00");
});

test("formatDurationClock returns zero padded mm:ss", () => {
  assert.equal(formatDurationClock(0), "00:00");
  assert.equal(formatDurationClock(65), "01:05");
  assert.equal(formatDurationClock(3599), "59:59");
});

test("formatDurationClock handles invalid input", () => {
  assert.equal(formatDurationClock(-1), "00:00");
  assert.equal(formatDurationClock(Number.NaN), "00:00");
  assert.equal(formatDurationClock(Infinity), "00:00");
});
