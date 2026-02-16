import { fetchCatalog, pool } from "./catalogService.js";

const MAX_LIKED_TRACKS = 500;
const MAX_FOLLOWED_ARTISTS = 300;
const MAX_HISTORY_TRACKS = 100;
const MAX_QUEUE_TRACKS = 500;
const USER_STATE_COLUMN_MISSING_ERROR_CODE = "42703";

function uniqueStrings(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const next = String(value ?? "").trim();
    if (!next || seen.has(next)) {
      continue;
    }
    seen.add(next);
    result.push(next);
  }
  return result;
}

function sanitizeWithAllowlist(values, allowlistSet, limit) {
  return uniqueStrings(values)
    .filter((value) => allowlistSet.has(value))
    .slice(0, limit);
}

function normalizeArrayValue(raw) {
  return Array.isArray(raw) ? raw : [];
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

function asBoolean(value) {
  return value === true;
}

function isMissingColumnError(error) {
  return String(error?.code ?? "") === USER_STATE_COLUMN_MISSING_ERROR_CODE;
}

export function emptyUserState() {
  return {
    likedTrackIds: [],
    followedArtistIds: [],
    historyTrackIds: [],
    queueTrackIds: [],
    queueCurrentIndex: 0,
    queueProgressSec: 0,
    queueIsPlaying: false,
  };
}

export async function ensureUserStateRow(userId) {
  const now = Date.now();
  await pool.query(
    `
    insert into user_states (user_id, liked_track_ids, followed_artist_ids, history_track_ids, updated_at)
    values ($1, array[]::text[], array[]::text[], array[]::text[], $2)
    on conflict (user_id) do nothing;
  `,
    [userId, now]
  );
}

export async function fetchUserState(userId) {
  await ensureUserStateRow(userId);

  let rows = [];
  try {
    ({ rows } = await pool.query(
      `
      select
        liked_track_ids as "likedTrackIds",
        followed_artist_ids as "followedArtistIds",
        history_track_ids as "historyTrackIds",
        queue_track_ids as "queueTrackIds",
        queue_current_index as "queueCurrentIndex",
        queue_progress_sec as "queueProgressSec",
        queue_is_playing as "queueIsPlaying"
      from user_states
      where user_id = $1
      limit 1;
    `,
      [userId]
    ));
  } catch (error) {
    if (!isMissingColumnError(error)) {
      throw error;
    }
    ({ rows } = await pool.query(
      `
      select
        liked_track_ids as "likedTrackIds",
        followed_artist_ids as "followedArtistIds",
        history_track_ids as "historyTrackIds"
      from user_states
      where user_id = $1
      limit 1;
    `,
      [userId]
    ));
  }

  const row = rows[0];
  if (!row) {
    return emptyUserState();
  }

  return {
    likedTrackIds: normalizeArrayValue(row.likedTrackIds),
    followedArtistIds: normalizeArrayValue(row.followedArtistIds),
    historyTrackIds: normalizeArrayValue(row.historyTrackIds),
    queueTrackIds: normalizeArrayValue(row.queueTrackIds),
    queueCurrentIndex: clampInteger(row.queueCurrentIndex, 0, 0, 100_000),
    queueProgressSec: clampNumber(row.queueProgressSec, 0, 0, 60 * 60 * 24),
    queueIsPlaying: asBoolean(row.queueIsPlaying),
  };
}

export async function sanitizeUserStateInput(input) {
  const state = input ?? {};
  const catalog = await fetchCatalog();
  const trackIdSet = new Set(catalog.tracks.map((track) => track.id));
  const artistIdSet = new Set(catalog.artists.map((artist) => artist.id));
  const queueTrackIds = sanitizeWithAllowlist(state.queueTrackIds, trackIdSet, MAX_QUEUE_TRACKS);
  const queueCurrentIndex = clampInteger(
    state.queueCurrentIndex,
    0,
    0,
    Math.max(queueTrackIds.length - 1, 0)
  );
  const fallbackQueueTrack = queueTrackIds[queueCurrentIndex] ? catalog.trackMap[queueTrackIds[queueCurrentIndex]] : null;
  const maxProgress = Math.max(Number(fallbackQueueTrack?.durationSec ?? 0), 0);
  const queueProgressSec = clampNumber(state.queueProgressSec, 0, 0, maxProgress || 60 * 60 * 24);

  return {
    likedTrackIds: sanitizeWithAllowlist(state.likedTrackIds, trackIdSet, MAX_LIKED_TRACKS),
    followedArtistIds: sanitizeWithAllowlist(state.followedArtistIds, artistIdSet, MAX_FOLLOWED_ARTISTS),
    historyTrackIds: sanitizeWithAllowlist(state.historyTrackIds, trackIdSet, MAX_HISTORY_TRACKS),
    queueTrackIds,
    queueCurrentIndex,
    queueProgressSec,
    queueIsPlaying: asBoolean(state.queueIsPlaying),
  };
}

export async function updateUserState(userId, nextStateInput) {
  const nextState = await sanitizeUserStateInput(nextStateInput);
  const now = Date.now();

  try {
    await pool.query(
      `
      insert into user_states (
        user_id,
        liked_track_ids,
        followed_artist_ids,
        history_track_ids,
        queue_track_ids,
        queue_current_index,
        queue_progress_sec,
        queue_is_playing,
        updated_at
      )
      values ($1, $2::text[], $3::text[], $4::text[], $5::text[], $6, $7, $8, $9)
      on conflict (user_id) do update
        set liked_track_ids = excluded.liked_track_ids,
            followed_artist_ids = excluded.followed_artist_ids,
            history_track_ids = excluded.history_track_ids,
            queue_track_ids = excluded.queue_track_ids,
            queue_current_index = excluded.queue_current_index,
            queue_progress_sec = excluded.queue_progress_sec,
            queue_is_playing = excluded.queue_is_playing,
            updated_at = excluded.updated_at;
    `,
      [
        userId,
        nextState.likedTrackIds,
        nextState.followedArtistIds,
        nextState.historyTrackIds,
        nextState.queueTrackIds,
        nextState.queueCurrentIndex,
        nextState.queueProgressSec,
        nextState.queueIsPlaying,
        now,
      ]
    );
  } catch (error) {
    if (!isMissingColumnError(error)) {
      throw error;
    }
    await pool.query(
      `
      insert into user_states (user_id, liked_track_ids, followed_artist_ids, history_track_ids, updated_at)
      values ($1, $2::text[], $3::text[], $4::text[], $5)
      on conflict (user_id) do update
        set liked_track_ids = excluded.liked_track_ids,
            followed_artist_ids = excluded.followed_artist_ids,
            history_track_ids = excluded.history_track_ids,
            updated_at = excluded.updated_at;
    `,
      [userId, nextState.likedTrackIds, nextState.followedArtistIds, nextState.historyTrackIds, now]
    );
  }

  return nextState;
}
