import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { syncDirectoryMissingFiles } from "../scripts/portable/portableSnapshot.mjs";

function createTempDirectory(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("syncDirectoryMissingFiles copies only missing files and keeps existing ones", () => {
  const sourceRoot = createTempDirectory("portable-source-");
  const destinationRoot = createTempDirectory("portable-destination-");

  fs.mkdirSync(path.join(sourceRoot, "tracks"), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, "hls", "demo"), { recursive: true });

  fs.writeFileSync(path.join(sourceRoot, "tracks", "one.mp3"), "source-one", "utf8");
  fs.writeFileSync(path.join(sourceRoot, "tracks", "two.mp3"), "source-two", "utf8");
  fs.writeFileSync(path.join(sourceRoot, "hls", "demo", "master.m3u8"), "manifest", "utf8");

  fs.mkdirSync(path.join(destinationRoot, "tracks"), { recursive: true });
  fs.writeFileSync(path.join(destinationRoot, "tracks", "one.mp3"), "existing-one", "utf8");

  const copiedFileCount = syncDirectoryMissingFiles(sourceRoot, destinationRoot);

  assert.equal(copiedFileCount, 2);
  assert.equal(
    fs.readFileSync(path.join(destinationRoot, "tracks", "one.mp3"), "utf8"),
    "existing-one"
  );
  assert.equal(
    fs.readFileSync(path.join(destinationRoot, "tracks", "two.mp3"), "utf8"),
    "source-two"
  );
  assert.equal(
    fs.readFileSync(path.join(destinationRoot, "hls", "demo", "master.m3u8"), "utf8"),
    "manifest"
  );

  fs.rmSync(sourceRoot, { recursive: true, force: true });
  fs.rmSync(destinationRoot, { recursive: true, force: true });
});
