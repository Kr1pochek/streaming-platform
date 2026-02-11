import assert from "node:assert/strict";
import test from "node:test";
import {
  isUsernameUniqueViolation,
  resolveSeedUserConfig,
} from "../server/services/authService.js";

test("resolveSeedUserConfig returns null when seed credentials are absent", () => {
  assert.equal(resolveSeedUserConfig({}), null);
});

test("resolveSeedUserConfig normalizes username and display name", () => {
  const result = resolveSeedUserConfig({
    SEED_USERNAME: " Demo.User ",
    SEED_PASSWORD: "secret-123",
    SEED_DISPLAY_NAME: " Demo Name ",
  });

  assert.deepEqual(result, {
    username: "demo.user",
    password: "secret-123",
    displayName: "Demo Name",
  });
});

test("resolveSeedUserConfig requires username and password together", () => {
  assert.throws(
    () => resolveSeedUserConfig({ SEED_USERNAME: "demo" }),
    /SEED_USERNAME and SEED_PASSWORD must be provided together/
  );
  assert.throws(
    () => resolveSeedUserConfig({ SEED_PASSWORD: "secret" }),
    /SEED_USERNAME and SEED_PASSWORD must be provided together/
  );
});

test("isUsernameUniqueViolation detects postgres unique violation by code and constraint", () => {
  assert.equal(
    isUsernameUniqueViolation({
      code: "23505",
      constraint: "idx_users_username_lower",
    }),
    true
  );
});

test("isUsernameUniqueViolation supports fallback checks", () => {
  assert.equal(
    isUsernameUniqueViolation({
      code: "23505",
      constraint: "users_username_key",
    }),
    true
  );
  assert.equal(
    isUsernameUniqueViolation({
      message: "duplicate key value violates unique constraint \"idx_users_username_lower\"",
    }),
    true
  );
  assert.equal(isUsernameUniqueViolation({ code: "22001" }), false);
});
