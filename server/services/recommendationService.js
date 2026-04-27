import { buildWaveQueuePlan } from "../../shared/waveRecommendations.js";
import { fetchCatalog, normalizeArtistName, splitArtistNames } from "./catalogService.js";
import { fetchUserState } from "./userStateService.js";

function uniqueTrackIds(trackIds = [], trackMap = {}) {
  const seen = new Set();
  const ids = [];

  for (const trackId of trackIds) {
    const normalizedTrackId = String(trackId ?? "").trim();
    if (!normalizedTrackId || seen.has(normalizedTrackId) || !trackMap[normalizedTrackId]) {
      continue;
    }
    seen.add(normalizedTrackId);
    ids.push(normalizedTrackId);
  }

  return ids;
}

function rankPlaylists(playlists, topTrackIds = []) {
  const topSet = new Set(topTrackIds);
  return playlists
    .map((playlist) => {
      const overlap = playlist.trackIds.filter((id) => topSet.has(id)).length;
      return {
        playlist,
        score: overlap + playlist.trackIds.length * 0.01,
      };
    })
    .sort((left, right) => right.score - left.score);
}

function rankArtists(artists, recommendedTracks = []) {
  const scoreMap = new Map();
  for (const track of recommendedTracks) {
    for (const artistName of splitArtistNames(track.artist)) {
      const normalized = normalizeArtistName(artistName);
      scoreMap.set(normalized, (scoreMap.get(normalized) ?? 0) + 1);
    }
  }

  return artists
    .map((artist) => ({
      artist,
      score: scoreMap.get(normalizeArtistName(artist.name)) ?? 0,
    }))
    .sort((left, right) => right.score - left.score);
}

export async function getSmartRecommendations({ userId = null, limitTracks = 6, limitPlaylists = 4, limitArtists = 6 } = {}) {
  const catalog = await fetchCatalog();
  const userState = userId
    ? await fetchUserState(userId)
    : { likedTrackIds: [], followedArtistIds: [], historyTrackIds: [] };
  const likedTrackIds = uniqueTrackIds(userState.likedTrackIds ?? [], catalog.trackMap);
  const waveQueuePlan = buildWaveQueuePlan(catalog.tracks, {
    likedTrackIds,
    limit: limitTracks,
  });
  const finalTracks = waveQueuePlan.trackIds.map((trackId) => catalog.trackMap[trackId]).filter(Boolean);

  const playlistRanking = rankPlaylists(catalog.playlists, finalTracks.map((track) => track.id));
  const artistRanking = rankArtists(catalog.artists, finalTracks);

  return {
    tracks: finalTracks,
    playlists: playlistRanking.map((item) => item.playlist).slice(0, limitPlaylists),
    artists: artistRanking.map((item) => item.artist).slice(0, limitArtists),
  };
}
