import { splitArtistNames } from "../../shared/artistNameParsing.js";

const SYSTEM_PLAYLIST_ID_PREFIX = "sys-";
const MIN_TRACKS_FOR_FULL_CATALOG = 6;
const MAX_COLLECTIONS = 5;
const MAX_PLAYLIST_COLLECTIONS = 2;
const MAX_ARTIST_COLLECTIONS = 3;
const MAX_HOME_GENRE_TAGS = 6;
const FALLBACK_GRADIENT = "linear-gradient(135deg, #314158 0%, #5a7ca8 48%, #171d26 100%)";
const excludedHomeGenreTags = new Set([
  "auto",
  "discover",
  "driving",
  "focus",
  "late night",
  "late-night",
  "new",
  "night",
  "popular",
  "trending",
]);

function normalizeArtistName(value = "") {
  return String(value ?? "").trim().toLowerCase();
}

function isSystemPlaylist(playlist) {
  return Boolean(playlist?.isSystem) || String(playlist?.id ?? "").startsWith(SYSTEM_PLAYLIST_ID_PREFIX);
}

function trackWord(count) {
  const safeCount = Math.max(0, Number(count ?? 0));
  const remainder100 = safeCount % 100;
  const remainder10 = safeCount % 10;
  if (remainder100 >= 11 && remainder100 <= 14) {
    return "треков";
  }
  if (remainder10 === 1) {
    return "трек";
  }
  if (remainder10 >= 2 && remainder10 <= 4) {
    return "трека";
  }
  return "треков";
}

function formatTrackCount(count) {
  const safeCount = Math.max(0, Number(count ?? 0));
  return `${safeCount} ${trackWord(safeCount)}`;
}

function findPrimaryArtistForTrack(track, artists = []) {
  const [primaryArtistName = ""] = splitArtistNames(track?.artist);
  const normalizedArtistName = normalizeArtistName(primaryArtistName);
  if (!normalizedArtistName) {
    return null;
  }
  return (
    artists.find((artist) => normalizeArtistName(artist?.name) === normalizedArtistName) ?? null
  );
}

function compareByTitle(left = "", right = "") {
  return String(left ?? "").localeCompare(String(right ?? ""), "ru");
}

function normalizeTagKey(value = "") {
  return String(value ?? "").trim().toLowerCase();
}

function formatTagLabel(value = "") {
  return String(value ?? "")
    .trim()
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (/^[a-z]{1,4}$/i.test(word)) {
        return word.toUpperCase();
      }
      return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
    })
    .join(" ");
}

function resolvePrimaryGenreTag(track) {
  const tags = Array.isArray(track?.tags) ? track.tags : [];
  for (const tag of tags) {
    const normalizedTag = normalizeTagKey(tag);
    if (!normalizedTag || excludedHomeGenreTags.has(normalizedTag)) {
      continue;
    }
    return normalizedTag;
  }
  return "";
}

function summarizePlaylistCollection(playlist) {
  const trackCount = Array.isArray(playlist?.trackIds) ? playlist.trackIds.length : 0;
  return {
    id: `playlist:${playlist.id}`,
    type: "playlist",
    targetId: playlist.id,
    title: playlist.title,
    subtitle: isSystemPlaylist(playlist)
      ? `Подборка из того, что уже доступно • ${formatTrackCount(trackCount)}`
      : `${formatTrackCount(trackCount)} в плейлисте`,
    gradient: playlist.cover || FALLBACK_GRADIENT,
  };
}

function summarizeArtistCollection(artistStat) {
  return {
    id: `artist:${artistStat.artist.id}`,
    type: "artist",
    targetId: artistStat.artist.id,
    title: artistStat.artist.name,
    subtitle: `${formatTrackCount(artistStat.trackCount)} в каталоге`,
    gradient: artistStat.cover || FALLBACK_GRADIENT,
  };
}

export function buildCatalogState({ tracks = [], playlists = [] } = {}) {
  const visibleTracks = Array.isArray(tracks) ? tracks.filter((track) => track?.id).length : 0;
  const visiblePlaylists = Array.isArray(playlists)
    ? playlists.filter((playlist) => Array.isArray(playlist?.trackIds) && playlist.trackIds.length > 0).length
    : 0;
  const systemPlaylists = Array.isArray(playlists)
    ? playlists.filter(
        (playlist) =>
          Array.isArray(playlist?.trackIds) && playlist.trackIds.length > 0 && isSystemPlaylist(playlist)
      ).length
    : 0;

  return {
    visibleTracks,
    visiblePlaylists,
    systemPlaylists,
    sparseCatalog: visibleTracks < MIN_TRACKS_FOR_FULL_CATALOG,
  };
}

export function buildHomeGenreTags({ tracks = [], fallbackTags = [] } = {}) {
  const genreSummary = new Map();
  const safeTracks = Array.isArray(tracks) ? tracks.filter((track) => track?.id) : [];

  for (const track of safeTracks) {
    const genreTag = resolvePrimaryGenreTag(track);
    if (!genreTag) {
      continue;
    }

    const current = genreSummary.get(genreTag) ?? {
      count: 0,
      freshestCreatedAt: 0,
    };

    genreSummary.set(genreTag, {
      count: current.count + 1,
      freshestCreatedAt: Math.max(current.freshestCreatedAt, Number(track.createdAt ?? 0)),
    });
  }

  const liveTags = [...genreSummary.entries()]
    .sort(
      (left, right) =>
        right[1].count - left[1].count ||
        right[1].freshestCreatedAt - left[1].freshestCreatedAt ||
        compareByTitle(left[0], right[0])
    )
    .slice(0, MAX_HOME_GENRE_TAGS)
    .map(([tag]) => formatTagLabel(tag));

  if (liveTags.length) {
    return liveTags;
  }

  return (Array.isArray(fallbackTags) ? fallbackTags : [])
    .map((tag) => formatTagLabel(tag))
    .filter(Boolean)
    .slice(0, MAX_HOME_GENRE_TAGS);
}

export function buildSearchCollections({ playlists = [], tracks = [], artists = [] } = {}) {
  const collections = [];
  const availablePlaylists = Array.isArray(playlists)
    ? playlists
        .filter((playlist) => Array.isArray(playlist?.trackIds) && playlist.trackIds.length > 0)
        .sort((first, second) => {
          const systemDelta = Number(isSystemPlaylist(second)) - Number(isSystemPlaylist(first));
          if (systemDelta !== 0) {
            return systemDelta;
          }
          const trackDelta = (second.trackIds?.length ?? 0) - (first.trackIds?.length ?? 0);
          if (trackDelta !== 0) {
            return trackDelta;
          }
          return compareByTitle(first.title, second.title);
        })
    : [];

  for (const playlist of availablePlaylists) {
    if (collections.length >= MAX_PLAYLIST_COLLECTIONS) {
      break;
    }
    collections.push(summarizePlaylistCollection(playlist));
  }

  const artistStats = new Map();
  const safeTracks = Array.isArray(tracks) ? tracks.filter((track) => track?.id) : [];
  const safeArtists = Array.isArray(artists) ? artists.filter((artist) => artist?.id) : [];
  for (const track of safeTracks) {
    const artist = findPrimaryArtistForTrack(track, safeArtists);
    if (!artist) {
      continue;
    }
    const current = artistStats.get(artist.id) ?? {
      artist,
      trackCount: 0,
      cover: track.cover || FALLBACK_GRADIENT,
    };
    artistStats.set(artist.id, {
      ...current,
      trackCount: current.trackCount + 1,
      cover: current.cover || track.cover || FALLBACK_GRADIENT,
    });
  }

  const topArtists = [...artistStats.values()]
    .sort(
      (first, second) =>
        second.trackCount - first.trackCount || compareByTitle(first.artist?.name, second.artist?.name)
    )
    .slice(0, MAX_ARTIST_COLLECTIONS);

  for (const artistStat of topArtists) {
    if (collections.length >= MAX_COLLECTIONS) {
      break;
    }
    collections.push(summarizeArtistCollection(artistStat));
  }

  return collections.slice(0, MAX_COLLECTIONS);
}
