import { fetchCatalog, pool } from "./catalogService.js";

const MAX_LIKED_TRACKS = 500;
const MAX_FOLLOWED_ARTISTS = 300;
const MAX_HISTORY_TRACKS = 100;

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

export function emptyUserState() {
  return {
    likedTrackIds: [],
    followedArtistIds: [],
    historyTrackIds: [],
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

  const { rows } = await pool.query(
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
  );

  const row = rows[0];
  if (!row) {
    return emptyUserState();
  }

  return {
    likedTrackIds: normalizeArrayValue(row.likedTrackIds),
    followedArtistIds: normalizeArrayValue(row.followedArtistIds),
    historyTrackIds: normalizeArrayValue(row.historyTrackIds),
  };
}

export async function sanitizeUserStateInput(input) {
  const state = input ?? {};
  const catalog = await fetchCatalog();
  const trackIdSet = new Set(catalog.tracks.map((track) => track.id));
  const artistIdSet = new Set(catalog.artists.map((artist) => artist.id));

  return {
    likedTrackIds: sanitizeWithAllowlist(state.likedTrackIds, trackIdSet, MAX_LIKED_TRACKS),
    followedArtistIds: sanitizeWithAllowlist(state.followedArtistIds, artistIdSet, MAX_FOLLOWED_ARTISTS),
    historyTrackIds: sanitizeWithAllowlist(state.historyTrackIds, trackIdSet, MAX_HISTORY_TRACKS),
  };
}

export async function updateUserState(userId, nextStateInput) {
  const nextState = await sanitizeUserStateInput(nextStateInput);
  const now = Date.now();

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

  return nextState;
}
