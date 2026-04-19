import test from "node:test";
import assert from "node:assert/strict";
import { isDefaultCatalogSeedEnabled } from "../server/services/catalogService.js";

test("default catalog seed is disabled by default", () => {
  assert.equal(isDefaultCatalogSeedEnabled({}), false);
  assert.equal(isDefaultCatalogSeedEnabled({ ENABLE_DEFAULT_CATALOG_SEED: "" }), false);
});

test("default catalog seed flag respects boolean-like values", () => {
  assert.equal(isDefaultCatalogSeedEnabled({ ENABLE_DEFAULT_CATALOG_SEED: "true" }), true);
  assert.equal(isDefaultCatalogSeedEnabled({ ENABLE_DEFAULT_CATALOG_SEED: "1" }), true);
  assert.equal(isDefaultCatalogSeedEnabled({ ENABLE_DEFAULT_CATALOG_SEED: "false" }), false);
  assert.equal(isDefaultCatalogSeedEnabled({ ENABLE_DEFAULT_CATALOG_SEED: "0" }), false);
});
