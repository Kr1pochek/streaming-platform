import assert from "node:assert/strict";
import test from "node:test";
import { validatePassword, validateUsername } from "../server/services/authService.js";

test("validateUsername accepts lowercase login with symbols", () => {
  const result = validateUsername("User.Name-12");
  assert.equal(result.valid, true);
  assert.equal(result.value, "user.name-12");
});

test("validateUsername rejects too short value", () => {
  const result = validateUsername("ab");
  assert.equal(result.valid, false);
  assert.equal(typeof result.message, "string");
});

test("validateUsername rejects unsupported characters", () => {
  const result = validateUsername("roman Иван");
  assert.equal(result.valid, false);
  assert.equal(typeof result.message, "string");
});

test("validatePassword accepts value in allowed range", () => {
  const result = validatePassword("secret123");
  assert.equal(result.valid, true);
  assert.equal(result.value, "secret123");
});

test("validatePassword rejects too short value", () => {
  const result = validatePassword("12345");
  assert.equal(result.valid, false);
  assert.equal(typeof result.message, "string");
});
