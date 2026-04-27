import assert from "node:assert/strict";
import test from "node:test";
import { buildWaveQueuePlan } from "../shared/waveRecommendations.js";

test("buildWaveQueuePlan prioritizes tracks with genres matching liked tracks", () => {
  const tracks = [
    { id: "liked-1", tags: ["rock", "alt"], createdAt: 10 },
    { id: "liked-2", tags: ["rock", "metal"], createdAt: 20 },
    { id: "related-1", tags: ["rock"], createdAt: 40 },
    { id: "related-2", tags: ["rock", "metal"], createdAt: 30 },
    { id: "fallback-1", tags: ["pop"], createdAt: 100 },
  ];

  const plan = buildWaveQueuePlan(tracks, {
    likedTrackIds: ["liked-1", "liked-2"],
    limit: 5,
    random: () => 0,
  });

  assert.equal(plan.strategy, "liked-genres");
  assert.equal(plan.startIndex, 0);
  assert.deepEqual(plan.trackIds.slice(0, 2), ["related-2", "related-1"]);
  assert.equal(new Set(plan.trackIds).size, 5);
  assert.equal(plan.trackIds.includes("fallback-1"), true);
});

test("buildWaveQueuePlan falls back to a random queue when liked tracks are absent", () => {
  const tracks = [{ id: "track-1" }, { id: "track-2" }, { id: "track-3" }];

  const plan = buildWaveQueuePlan(tracks, {
    likedTrackIds: [],
    limit: 3,
    random: () => 0,
  });

  assert.equal(plan.strategy, "random");
  assert.equal(plan.startIndex, 0);
  assert.deepEqual(plan.trackIds, ["track-2", "track-3", "track-1"]);
});
