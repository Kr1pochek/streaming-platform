import assert from "node:assert/strict";
import test from "node:test";
import {
  mediaPublicUrlForRelativePath,
  mediaStorageDriver,
  relativePathFromLocalMediaUrl,
} from "../server/services/mediaStorageService.js";

test("mediaStorageDriver defaults to local", () => {
  assert.equal(mediaStorageDriver({}), "local");
  assert.equal(mediaStorageDriver({ MEDIA_STORAGE_DRIVER: "LOCAL" }), "local");
  assert.equal(mediaStorageDriver({ MEDIA_STORAGE_DRIVER: "s3" }), "s3");
});

test("mediaPublicUrlForRelativePath returns encoded local media URL", () => {
  const url = mediaPublicUrlForRelativePath("tracks/город.mp3", {
    MEDIA_STORAGE_DRIVER: "local",
  });
  assert.equal(url, "/api/media/tracks/%D0%B3%D0%BE%D1%80%D0%BE%D0%B4.mp3");
});

test("mediaPublicUrlForRelativePath builds CDN URL for s3 driver", () => {
  const url = mediaPublicUrlForRelativePath("tracks/test.mp3", {
    MEDIA_STORAGE_DRIVER: "s3",
    MEDIA_CDN_BASE_URL: "https://cdn.example.com/audio",
    MEDIA_S3_BUCKET: "music",
  });
  assert.equal(url, "https://cdn.example.com/audio/tracks/test.mp3");
});

test("relativePathFromLocalMediaUrl extracts relative media path", () => {
  assert.equal(relativePathFromLocalMediaUrl("/api/media/tracks/demo.mp3"), "tracks/demo.mp3");
  assert.equal(relativePathFromLocalMediaUrl("https://cdn.example.com/tracks/demo.mp3"), "");
});
