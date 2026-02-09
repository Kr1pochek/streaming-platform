import { fetchCatalog, normalizeArtistName, splitArtistNames } from "./catalogService.js";
import { fetchUserState } from "./userStateService.js";

function buildTagScoreMap(tracks = []) {
  const scoreMap = new Map();
  for (const track of tracks) {
    for (const tag of track.tags ?? []) {
      const normalizedTag = String(tag ?? "").trim().toLowerCase();
      if (!normalizedTag) {
        continue;
      }
      scoreMap.set(normalizedTag, (scoreMap.get(normalizedTag) ?? 0) + 1);
    }
  }
  return scoreMap;
}

function artistIdsToNameSet(artists = [], artistIds = []) {
  const idSet = new Set(artistIds);
  const names = new Set();
  for (const artist of artists) {
    if (!idSet.has(artist.id)) {
      continue;
    }
    names.add(normalizeArtistName(artist.name));
  }
  return names;
}

function trackArtistNameSet(track) {
  return new Set(splitArtistNames(track.artist).map((item) => normalizeArtistName(item)));
}

function rankTracks(tracks, state, artists) {
  const likedSet = new Set(state.likedTrackIds ?? []);
  const historySet = new Set(state.historyTrackIds ?? []);
  const consumedSet = new Set([...likedSet, ...historySet]);

  const likedTracks = tracks.filter((track) => likedSet.has(track.id));
  const historyTracks = tracks.filter((track) => historySet.has(track.id));
  const preferenceTracks = [...likedTracks, ...historyTracks];
  const tagScoreMap = buildTagScoreMap(preferenceTracks);
  const followedArtistNames = artistIdsToNameSet(artists, state.followedArtistIds ?? []);

  return tracks
    .filter((track) => !consumedSet.has(track.id))
    .map((track, index) => {
      const trackTags = track.tags ?? [];
      const tagScore = trackTags.reduce(
        (sum, tag) => sum + (tagScoreMap.get(String(tag ?? "").trim().toLowerCase()) ?? 0),
        0
      );

      const artistNames = trackArtistNameSet(track);
      const followedArtistScore = [...artistNames].some((name) => followedArtistNames.has(name)) ? 4 : 0;
      const freshnessScore = Math.max(0, tracks.length - index) / tracks.length;
      const score = tagScore * 1.8 + followedArtistScore + freshnessScore;
      return { track, score };
    })
    .sort((left, right) => right.score - left.score);
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

  const trackRanking = rankTracks(catalog.tracks, userState, catalog.artists);
  const fallbackTracks = catalog.tracks.slice(0, limitTracks);
  const recommendedTracks = (trackRanking.map((item) => item.track).slice(0, limitTracks) || []).filter(Boolean);
  const finalTracks = recommendedTracks.length ? recommendedTracks : fallbackTracks;

  const playlistRanking = rankPlaylists(catalog.playlists, finalTracks.map((track) => track.id));
  const artistRanking = rankArtists(catalog.artists, finalTracks);

  return {
    tracks: finalTracks,
    playlists: playlistRanking.map((item) => item.playlist).slice(0, limitPlaylists),
    artists: artistRanking.map((item) => item.artist).slice(0, limitArtists),
  };
}
