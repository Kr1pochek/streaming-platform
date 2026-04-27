function normalizeTrackTag(value = "") {
  return String(value ?? "").trim().toLowerCase();
}

function shuffleItems(items = [], random = Math.random) {
  const nextItems = [...items];
  for (let index = nextItems.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [nextItems[index], nextItems[swapIndex]] = [nextItems[swapIndex], nextItems[index]];
  }
  return nextItems;
}

function uniqueTrackIds(trackIds = []) {
  const seen = new Set();
  const ids = [];
  for (const trackId of trackIds) {
    const normalizedId = String(trackId ?? "").trim();
    if (!normalizedId || seen.has(normalizedId)) {
      continue;
    }
    seen.add(normalizedId);
    ids.push(normalizedId);
  }
  return ids;
}

function buildLikedTagScoreMap(likedTracks = []) {
  const tagScoreMap = new Map();
  for (const track of likedTracks) {
    for (const tag of track?.tags ?? []) {
      const normalizedTag = normalizeTrackTag(tag);
      if (!normalizedTag) {
        continue;
      }
      tagScoreMap.set(normalizedTag, (tagScoreMap.get(normalizedTag) ?? 0) + 1);
    }
  }
  return tagScoreMap;
}

export function buildWaveQueuePlan(
  tracks = [],
  { likedTrackIds = [], limit = Number.POSITIVE_INFINITY, random = Math.random } = {}
) {
  const safeTracks = Array.isArray(tracks) ? tracks.filter((track) => track?.id) : [];
  const safeLimit = Math.max(0, Math.min(Number.isFinite(limit) ? Number(limit) : safeTracks.length, safeTracks.length));

  if (!safeTracks.length || safeLimit <= 0) {
    return {
      strategy: "empty",
      startIndex: 0,
      trackIds: [],
    };
  }

  const trackById = new Map(safeTracks.map((track) => [track.id, track]));
  const uniqueLikedTrackIds = uniqueTrackIds(likedTrackIds).filter((trackId) => trackById.has(trackId));
  const likedTracks = uniqueLikedTrackIds.map((trackId) => trackById.get(trackId)).filter(Boolean);

  if (!likedTracks.length) {
    return {
      strategy: "random",
      startIndex: 0,
      trackIds: shuffleItems(
        safeTracks.map((track) => track.id),
        random
      ).slice(0, safeLimit),
    };
  }

  const likedTrackIdSet = new Set(uniqueLikedTrackIds);
  const likedTagScoreMap = buildLikedTagScoreMap(likedTracks);
  const candidateTracks = safeTracks.filter((track) => !likedTrackIdSet.has(track.id));

  const rankedCandidateIds = candidateTracks
    .map((track) => {
      const normalizedTrackTags = (track.tags ?? [])
        .map((tag) => normalizeTrackTag(tag))
        .filter(Boolean);
      const tagScore = normalizedTrackTags.reduce(
        (totalScore, tag) => totalScore + (likedTagScoreMap.get(tag) ?? 0),
        0
      );
      const overlapCount = normalizedTrackTags.filter((tag) => likedTagScoreMap.has(tag)).length;

      return {
        trackId: track.id,
        tagScore,
        overlapCount,
        createdAt: Number(track.createdAt ?? 0),
      };
    })
    .filter((track) => track.tagScore > 0)
    .sort(
      (left, right) =>
        right.tagScore - left.tagScore ||
        right.overlapCount - left.overlapCount ||
        right.createdAt - left.createdAt ||
        left.trackId.localeCompare(right.trackId)
    )
    .map((track) => track.trackId);

  const rankedCandidateIdSet = new Set(rankedCandidateIds);
  const fallbackCandidateIds = shuffleItems(
    candidateTracks
      .map((track) => track.id)
      .filter((trackId) => !rankedCandidateIdSet.has(trackId)),
    random
  );
  const fallbackLikedTrackIds = shuffleItems(uniqueLikedTrackIds, random);

  return {
    strategy: "liked-genres",
    startIndex: 0,
    trackIds: [...rankedCandidateIds, ...fallbackCandidateIds, ...fallbackLikedTrackIds].slice(0, safeLimit),
  };
}
