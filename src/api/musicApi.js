import {
  artists,
  artistReleases,
  initialQueue,
  playlists,
  quickActions,
  searchCollections,
  showcases,
  tracks,
  vibeTags,
} from "../data/musicData.js";

const API_DELAY_MS = 320;
const trackMap = Object.fromEntries(tracks.map((track) => [track.id, track]));
const USER_PLAYLISTS_KEY = "music.user.playlists.v1";
const USER_PLAYLIST_ID_PREFIX = "upl-";
const customPlaylistCovers = [
  "linear-gradient(135deg, #5f739f 0%, #9ab2ff 50%, #22324d 100%)",
  "linear-gradient(135deg, #f28f6e 0%, #f8d0a5 44%, #7a3b2f 100%)",
  "linear-gradient(135deg, #8f83c9 0%, #c9c1ee 36%, #3a315a 100%)",
  "linear-gradient(135deg, #89ff5e 0%, #3bbf79 45%, #17352d 100%)",
  "linear-gradient(135deg, #f7d255 0%, #f3a2c5 44%, #5f3656 100%)",
];

function clone(data) {
  if (typeof structuredClone === "function") {
    return structuredClone(data);
  }
  return JSON.parse(JSON.stringify(data));
}

function delayed(data, shouldFail = false) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (shouldFail) {
        reject(new Error("Не удалось загрузить данные. Попробуй обновить страницу."));
        return;
      }
      resolve(clone(data));
    }, API_DELAY_MS);
  });
}

function normalizeTitle(value) {
  return String(value ?? "").trim();
}

function normalizeTrackIds(trackIds = []) {
  const seen = new Set();
  const ids = [];
  for (const trackId of trackIds) {
    if (trackMap[trackId] && !seen.has(trackId)) {
      seen.add(trackId);
      ids.push(trackId);
    }
  }
  return ids;
}

function isCustomPlaylistId(playlistId) {
  return String(playlistId).startsWith(USER_PLAYLIST_ID_PREFIX);
}

function coverForPlaylist(seed) {
  const hash = Math.abs(
    String(seed)
      .split("")
      .reduce((acc, char) => acc * 31 + char.charCodeAt(0), 0)
  );
  return customPlaylistCovers[hash % customPlaylistCovers.length];
}

function normalizeUserPlaylist(raw, fallbackIndex = 0) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const id = isCustomPlaylistId(raw.id)
    ? raw.id
    : `${USER_PLAYLIST_ID_PREFIX}${Date.now().toString(36)}-${fallbackIndex.toString(36)}`;
  const title = normalizeTitle(raw.title) || `Плейлист ${fallbackIndex + 1}`;
  const subtitle = normalizeTitle(raw.subtitle) || "Пользовательский плейлист";
  const trackIds = normalizeTrackIds(raw.trackIds);
  const createdAt = Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : Date.now();

  return {
    id,
    title,
    subtitle,
    cover: normalizeTitle(raw.cover) || coverForPlaylist(id),
    trackIds,
    createdAt,
    isCustom: true,
  };
}

function readUserPlaylists() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(USER_PLAYLISTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((playlist, index) => normalizeUserPlaylist(playlist, index))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function writeUserPlaylists(userPlaylists) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(USER_PLAYLISTS_KEY, JSON.stringify(userPlaylists));
  } catch {
    // noop
  }
}

function getAllPlaylists() {
  const userPlaylists = readUserPlaylists();
  return [...playlists, ...userPlaylists];
}

function includesText(text, query) {
  return text.toLowerCase().includes(query.toLowerCase());
}

function normalizeArtistName(value = "") {
  return value.toLowerCase().trim();
}

function splitArtistNames(value = "") {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function findArtistByName(name) {
  const normalizedName = normalizeArtistName(name);
  return artists.find((artist) => normalizeArtistName(artist.name) === normalizedName) ?? null;
}

function trackHasArtist(track, artistName) {
  const normalizedArtistName = normalizeArtistName(artistName);
  return splitArtistNames(track.artist).some((candidateName) => normalizeArtistName(candidateName) === normalizedArtistName);
}

function getPrimaryArtistForTrack(track) {
  const [primaryArtistName = ""] = splitArtistNames(track.artist);
  return findArtistByName(primaryArtistName);
}

export async function createUserPlaylist(title, options = {}) {
  const nextTitle = normalizeTitle(title);
  if (!nextTitle) {
    throw new Error("Название плейлиста не может быть пустым.");
  }

  const currentPlaylists = readUserPlaylists();
  const nextPlaylist = normalizeUserPlaylist(
    {
      id: `${USER_PLAYLIST_ID_PREFIX}${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      title: nextTitle,
      subtitle: "Пользовательский плейлист",
      cover: "",
      trackIds: [],
      createdAt: Date.now(),
    },
    currentPlaylists.length
  );
  const nextPlaylists = [nextPlaylist, ...currentPlaylists];
  writeUserPlaylists(nextPlaylists);
  return delayed(nextPlaylist, options.fail);
}

export async function renameUserPlaylist(playlistId, title, options = {}) {
  if (!isCustomPlaylistId(playlistId)) {
    throw new Error("Можно переименовать только пользовательский плейлист.");
  }

  const nextTitle = normalizeTitle(title);
  if (!nextTitle) {
    throw new Error("Название плейлиста не может быть пустым.");
  }

  const currentPlaylists = readUserPlaylists();
  const targetIndex = currentPlaylists.findIndex((playlist) => playlist.id === playlistId);
  if (targetIndex < 0) {
    throw new Error("Плейлист не найден.");
  }

  const nextPlaylists = [...currentPlaylists];
  nextPlaylists[targetIndex] = {
    ...nextPlaylists[targetIndex],
    title: nextTitle,
  };
  writeUserPlaylists(nextPlaylists);
  return delayed(nextPlaylists[targetIndex], options.fail);
}

export async function deleteUserPlaylist(playlistId, options = {}) {
  if (!isCustomPlaylistId(playlistId)) {
    throw new Error("Можно удалить только пользовательский плейлист.");
  }

  const currentPlaylists = readUserPlaylists();
  const nextPlaylists = currentPlaylists.filter((playlist) => playlist.id !== playlistId);
  if (nextPlaylists.length === currentPlaylists.length) {
    throw new Error("Плейлист не найден.");
  }
  writeUserPlaylists(nextPlaylists);
  return delayed({ success: true }, options.fail);
}

export async function addTrackToUserPlaylist(playlistId, trackId, options = {}) {
  if (!isCustomPlaylistId(playlistId)) {
    throw new Error("Трек можно добавлять только в пользовательский плейлист.");
  }
  if (!trackMap[trackId]) {
    throw new Error("Трек не найден.");
  }

  const currentPlaylists = readUserPlaylists();
  const targetIndex = currentPlaylists.findIndex((playlist) => playlist.id === playlistId);
  if (targetIndex < 0) {
    throw new Error("Плейлист не найден.");
  }

  const targetPlaylist = currentPlaylists[targetIndex];
  if (targetPlaylist.trackIds.includes(trackId)) {
    return delayed(targetPlaylist, options.fail);
  }

  const nextPlaylists = [...currentPlaylists];
  nextPlaylists[targetIndex] = {
    ...targetPlaylist,
    trackIds: [...targetPlaylist.trackIds, trackId],
  };
  writeUserPlaylists(nextPlaylists);
  return delayed(nextPlaylists[targetIndex], options.fail);
}

export async function removeTrackFromUserPlaylist(playlistId, trackId, options = {}) {
  if (!isCustomPlaylistId(playlistId)) {
    throw new Error("Трек можно удалять только из пользовательского плейлиста.");
  }
  if (!trackMap[trackId]) {
    throw new Error("Трек не найден.");
  }

  const currentPlaylists = readUserPlaylists();
  const targetIndex = currentPlaylists.findIndex((playlist) => playlist.id === playlistId);
  if (targetIndex < 0) {
    throw new Error("Плейлист не найден.");
  }

  const targetPlaylist = currentPlaylists[targetIndex];
  const nextPlaylists = [...currentPlaylists];
  nextPlaylists[targetIndex] = {
    ...targetPlaylist,
    trackIds: targetPlaylist.trackIds.filter((id) => id !== trackId),
  };
  writeUserPlaylists(nextPlaylists);
  return delayed(nextPlaylists[targetIndex], options.fail);
}

export async function fetchHomeFeed(options = {}) {
  const freshTrackIds = initialQueue.slice(1, 7);
  const enrichedShowcases = showcases.map((item) => {
    const playlist = playlists.find((candidate) => candidate.id === item.playlistId);
    return {
      ...item,
      trackIds: playlist?.trackIds ?? [],
    };
  });

  return delayed(
    {
      quickActions,
      showcases: enrichedShowcases,
      vibeTags,
      freshTrackIds,
    },
    options.fail
  );
}

export async function fetchSearchFeed(options = {}) {
  const allPlaylists = getAllPlaylists();
  const newTrackIds = tracks.slice(-8).map((track) => track.id);
  const morePlaylists = allPlaylists.map((item) => ({
    id: item.id,
    title: item.title,
    artist: item.subtitle,
    cover: item.cover,
    trackIds: item.trackIds,
  }));

  return delayed(
    {
      collections: searchCollections,
      newTrackIds,
      morePlaylists,
    },
    options.fail
  );
}

export async function searchCatalog(query, options = {}) {
  const filter = options.filter ?? "all";
  const allPlaylists = getAllPlaylists();
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return delayed({ tracks: [], playlists: [], artists: [], albums: [] }, options.fail);
  }

  const foundTracks = tracks.filter((track) =>
    [track.title, track.artist].some((field) => includesText(field, normalized))
  );
  const foundPlaylists = allPlaylists.filter((playlist) =>
    [playlist.title, playlist.subtitle].some((field) => includesText(field, normalized))
  );
  const foundArtists = artists.filter((artist) => includesText(artist.name, normalized));
  const foundAlbums = artistReleases
    .filter((release) => {
      const artist = artists.find((candidate) => candidate.id === release.artistId);
      return includesText(release.title, normalized) || includesText(artist?.name ?? "", normalized);
    })
    .map((release) => {
      const artist = artists.find((candidate) => candidate.id === release.artistId);
      const releaseTracks = release.trackIds.map((trackId) => trackMap[trackId]).filter(Boolean);
      return {
        ...release,
        artistName: artist?.name ?? "Unknown",
        tracks: releaseTracks,
      };
    })
    .sort((first, second) => second.year - first.year);

  const byFilter = {
    tracks: filter === "all" || filter === "tracks" ? foundTracks : [],
    playlists: filter === "all" || filter === "playlists" ? foundPlaylists : [],
    artists: filter === "all" || filter === "artists" ? foundArtists : [],
    albums: filter === "all" || filter === "albums" ? foundAlbums : [],
  };

  return delayed(
    {
      ...byFilter,
    },
    options.fail
  );
}

export async function fetchLibraryFeed(options = {}) {
  const allPlaylists = getAllPlaylists();
  return delayed(
    {
      playlists: allPlaylists,
      artists,
    },
    options.fail
  );
}

export async function fetchCatalogMap(options = {}) {
  return delayed({ tracks, trackMap, playlists: getAllPlaylists(), artists }, options.fail);
}

export async function fetchPlaylistPage(playlistId, options = {}) {
  const allPlaylists = getAllPlaylists();
  const playlist = allPlaylists.find((item) => item.id === playlistId);
  if (!playlist) {
    throw new Error("Плейлист не найден.");
  }

  const playlistTracks = playlist.trackIds.map((id) => trackMap[id]).filter(Boolean);
  const overlapScore = (candidate) =>
    candidate.trackIds.filter((id) => playlist.trackIds.includes(id)).length;

  const relatedPlaylists = allPlaylists
    .filter((item) => item.id !== playlistId)
    .sort((a, b) => overlapScore(b) - overlapScore(a))
    .slice(0, 3);

  return delayed(
    {
      playlist,
      tracks: playlistTracks,
      relatedPlaylists,
    },
    options.fail
  );
}

export async function fetchTrackPage(trackId, options = {}) {
  const allPlaylists = getAllPlaylists();
  const userPlaylists = readUserPlaylists();
  const track = trackMap[trackId];
  if (!track) {
    throw new Error("Трек не найден.");
  }

  const artist = getPrimaryArtistForTrack(track);
  const inPlaylists = allPlaylists.filter((playlist) => playlist.trackIds.includes(trackId));
  const playlistToggles = userPlaylists.map((playlist) => ({
    ...playlist,
    hasTrack: playlist.trackIds.includes(trackId),
  }));
  const moreByArtist = tracks.filter((item) => item.artist === track.artist && item.id !== trackId).slice(0, 6);
  const trackScore = (candidate) =>
    candidate.artist === track.artist ? 4 : candidate.tags.filter((tag) => track.tags.includes(tag)).length;

  const relatedTracks = tracks
    .filter((item) => item.id !== trackId)
    .sort((a, b) => trackScore(b) - trackScore(a))
    .slice(0, 8);

  return delayed(
    {
      track,
      artist,
      inPlaylists,
      playlistToggles,
      moreByArtist,
      relatedTracks,
    },
    options.fail
  );
}

export async function fetchArtistPage(artistId, options = {}) {
  const allPlaylists = getAllPlaylists();
  const artist = artists.find((item) => item.id === artistId);
  if (!artist) {
    throw new Error("Исполнитель не найден.");
  }

  const artistTracks = tracks.filter((track) => trackHasArtist(track, artist.name));
  const artistTrackIds = new Set(artistTracks.map((track) => track.id));
  const topTracks = artistTracks.slice(0, 8);

  const releases = artistReleases
    .filter((release) => release.artistId === artist.id)
    .map((release) => ({
      ...release,
      artistName: artist.name,
      tracks: release.trackIds.map((trackId) => trackMap[trackId]).filter(Boolean),
    }))
    .sort((first, second) => second.year - first.year);

  const albums = releases.filter((release) => release.type === "album");
  const eps = releases.filter((release) => release.type === "ep");
  const singles = releases.filter((release) => release.type === "single");
  const latestRelease = releases[0] ?? null;
  const popularAlbums = albums.slice(0, 10);

  const featuredPlaylists = allPlaylists
    .filter((playlist) => playlist.trackIds.some((trackId) => artistTrackIds.has(trackId)))
    .slice(0, 4);

  const artistTagSet = new Set(artistTracks.flatMap((track) => track.tags));
  const relatedScore = (candidateName) =>
    tracks.filter(
      (track) => trackHasArtist(track, candidateName) && track.tags.some((tag) => artistTagSet.has(tag))
    ).length;

  const relatedArtists = artists
    .filter((candidate) => candidate.id !== artist.id)
    .sort((first, second) => relatedScore(second.name) - relatedScore(first.name))
    .slice(0, 4)
    .map((candidate) => ({ ...candidate }));

  return delayed(
    {
      artist,
      topTracks,
      latestRelease,
      popularAlbums,
      albums,
      eps,
      singles,
      featuredPlaylists,
      relatedArtists,
    },
    options.fail
  );
}

export async function fetchReleasePage(releaseId, options = {}) {
  const allPlaylists = getAllPlaylists();
  const release = artistReleases.find((item) => item.id === releaseId);
  if (!release) {
    throw new Error("Релиз не найден.");
  }

  const artist = artists.find((item) => item.id === release.artistId) ?? null;
  const releaseTracks = release.trackIds.map((trackId) => trackMap[trackId]).filter(Boolean);
  const totalDurationSec = releaseTracks.reduce((sum, track) => sum + (track.durationSec ?? 0), 0);

  const moreReleasesByArtist = artistReleases
    .filter((item) => item.artistId === release.artistId && item.id !== release.id)
    .sort((first, second) => second.year - first.year)
    .map((item) => ({
      ...item,
      artistName: artist?.name ?? "",
      tracks: item.trackIds.map((trackId) => trackMap[trackId]).filter(Boolean),
    }))
    .slice(0, 8);

  const relatedPlaylists = allPlaylists
    .filter((playlist) => playlist.trackIds.some((trackId) => release.trackIds.includes(trackId)))
    .slice(0, 4);

  return delayed(
    {
      release: {
        ...release,
        artistName: artist?.name ?? "",
        tracks: releaseTracks,
      },
      artist,
      tracks: releaseTracks,
      totalDurationSec,
      moreReleasesByArtist,
      relatedPlaylists,
    },
    options.fail
  );
}

export async function fetchSmartRecommendations(options = {}) {
  const uniqueTrackIds = [...new Set([...initialQueue, ...tracks.map((track) => track.id)])];
  const recommendedTracks = uniqueTrackIds.map((trackId) => trackMap[trackId]).filter(Boolean).slice(0, 6);
  const recommendedPlaylists = getAllPlaylists().slice(0, 4);
  const recommendedArtists = artists.slice(0, 6);

  return delayed(
    {
      tracks: recommendedTracks,
      playlists: recommendedPlaylists,
      artists: recommendedArtists,
    },
    options.fail
  );
}
