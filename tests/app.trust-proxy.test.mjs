import assert from "node:assert/strict";
import test from "node:test";
import { parseTrustProxySetting } from "../server/app.js";

test("parseTrustProxySetting defaults to false", () => {
  assert.equal(parseTrustProxySetting(null), false);
  assert.equal(parseTrustProxySetting(""), false);
  assert.equal(parseTrustProxySetting("false"), false);
  assert.equal(parseTrustProxySetting("0"), false);
});

test("parseTrustProxySetting handles boolean-like strings", () => {
  assert.equal(parseTrustProxySetting("true"), true);
  assert.equal(parseTrustProxySetting("1"), true);
  assert.equal(parseTrustProxySetting("yes"), true);
  assert.equal(parseTrustProxySetting("on"), true);
});

test("parseTrustProxySetting handles numeric and named values", () => {
  assert.equal(parseTrustProxySetting("2"), 2);
  assert.equal(parseTrustProxySetting("loopback"), "loopback");
  assert.equal(parseTrustProxySetting("10.0.0.1"), "10.0.0.1");
});
