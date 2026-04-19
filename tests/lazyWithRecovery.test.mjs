import test from "node:test";
import assert from "node:assert/strict";
import { isRecoverableLazyImportError } from "../src/utils/lazyWithRecovery.js";

test("detects dynamic import failures from stale frontend chunks", () => {
  assert.equal(
    isRecoverableLazyImportError(new Error("Failed to fetch dynamically imported module")),
    true
  );
  assert.equal(
    isRecoverableLazyImportError(new Error("ChunkLoadError: Loading CSS chunk 42 failed.")),
    true
  );
  assert.equal(
    isRecoverableLazyImportError(new Error("Importing a module script failed.")),
    true
  );
});

test("does not mark regular render errors as chunk reload problems", () => {
  assert.equal(isRecoverableLazyImportError(new Error("Cannot read properties of undefined")), false);
  assert.equal(isRecoverableLazyImportError(""), false);
  assert.equal(isRecoverableLazyImportError(null), false);
});
