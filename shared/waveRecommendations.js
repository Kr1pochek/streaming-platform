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

function fillTrackIds(preferredTrackIds = [], fallbackTrackIds = [], limit = Number.POSITIVE_INFINITY) {
  const seen = new Set();
  const trackIds = [];
  for (const trackId of [...preferredTrackIds, ...fallbackTrackIds]) {
    if (!trackId || seen.has(trackId)) {
      continue;
    }
    seen.add(trackId);
    trackIds.push(trackId);
    if (trackIds.length >= limit) {
      break;
    }
  }
  return trackIds;
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
  { likedTrackIds = [], excludeTrackIds = [], limit = Number.POSITIVE_INFINITY, random = Math.random } = {}
) {
  const safeTracks = Array.isArray(tracks) ? tracks.filter((track) => track?.id) : [];
  const safeLimit = Math.max(0, Math.min(Number.isFinite(limit) ? Number(limit) : safeTracks.length, safeTracks.length));
  const excludedTrackIdSet = new Set(uniqueTrackIds(excludeTrackIds).filter((trackId) => safeTracks.some((track) => track.id === trackId)));

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
    const preferredTrackIds = shuffleItems(
      safeTracks
        .map((track) => track.id)
        .filter((trackId) => !excludedTrackIdSet.has(trackId)),
      random
    );
    const fallbackTrackIds = shuffleItems(
      safeTracks
        .map((track) => track.id)
        .filter((trackId) => excludedTrackIdSet.has(trackId)),
      random
    );

    return {
      strategy: "random",
      startIndex: 0,
      trackIds: fillTrackIds(preferredTrackIds, fallbackTrackIds, safeLimit),
    };
  }

  const likedTrackIdSet = new Set(uniqueLikedTrackIds);
  const likedTagScoreMap = buildLikedTagScoreMap(likedTracks);
  const candidateTracks = safeTracks.filter((track) => !likedTrackIdSet.has(track.id) && !excludedTrackIdSet.has(track.id));

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
  const fallbackExcludedTrackIds = shuffleItems(
    safeTracks
      .map((track) => track.id)
      .filter((trackId) => excludedTrackIdSet.has(trackId)),
    random
  );

  return {
    strategy: "liked-genres",
    startIndex: 0,
    trackIds: fillTrackIds(
      [...rankedCandidateIds, ...fallbackCandidateIds, ...fallbackLikedTrackIds],
      fallbackExcludedTrackIds,
      safeLimit
    ),
  };
}
