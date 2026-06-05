import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { splitArtistNames } from "../../shared/artistNameParsing.js";
import {
  artistReleases,
  artists as seedArtists,
  playlists as seedPlaylists,
  tracks as seedTracks,
} from "../../shared/musicData.js";
import {
  createSignedStreamUrl,
  getEmbeddedPlaybackUrlTtlMs,
  shouldEmbedSignedPlaybackUrl,
} from "./playbackService.js";

export { splitArtistNames };

export const USER_PLAYLIST_ID_PREFIX = "upl-";
export const SYSTEM_PLAYLIST_ID_PREFIX = "sys-";
export const DEFAULT_ERROR_MESSAGE = "Не удалось загрузить данные. Обнови страницу и попробуй снова.";
export const CUSTOM_PLAYLIST_SUBTITLE = "Custom playlist";
const LEGACY_CUSTOM_PLAYLIST_SUBTITLES = new Set([
  "Пользовательский плейлист",
  "Custom playlist",
]);
const customPlaylistCovers = [
  "linear-gradient(135deg, #5f739f 0%, #9ab2ff 50%, #22324d 100%)",
  "linear-gradient(135deg, #f28f6e 0%, #f8d0a5 44%, #7a3b2f 100%)",
  "linear-gradient(135deg, #8f83c9 0%, #c9c1ee 36%, #3a315a 100%)",
  "linear-gradient(135deg, #89ff5e 0%, #3bbf79 45%, #17352d 100%)",
  "linear-gradient(135deg, #f7d255 0%, #f3a2c5 44%, #5f3656 100%)",
];
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
export const mediaDirectory = path.resolve(currentDirectory, "../../public/audio");
export const mediaRoutePrefix = "/api/media/";
export const streamRoutePrefix = "/api/stream/";
export const hlsDirectory = path.resolve(mediaDirectory, "hls");
export const hlsRoutePrefix = `${mediaRoutePrefix}hls/`;
const hlsManifestCandidates = ["master.m3u8", "index.m3u8"];
const defaultSeedTrackIds = seedTracks.map((item) => String(item?.id ?? "").trim()).filter(Boolean);
const defaultSeedPlaylistIds = seedPlaylists.map((item) => String(item?.id ?? "").trim()).filter(Boolean);
const defaultSeedArtistIds = seedArtists.map((item) => String(item?.id ?? "").trim()).filter(Boolean);
const defaultSeedReleaseIds = artistReleases.map((item) => String(item?.id ?? "").trim()).filter(Boolean);

const trackOrderMap = new Map(seedTracks.map((item, index) => [item.id, index]));
const playlistOrderMap = new Map(seedPlaylists.map((item, index) => [item.id, index]));
const artistOrderMap = new Map(seedArtists.map((item, index) => [item.id, index]));
const artistNameMap = new Map(seedArtists.map((item) => [normalizeArtistName(item.name), item.id]));
const CATALOG_CACHE_TTL_MS = Number(process.env.CATALOG_CACHE_TTL_MS ?? 4000);
const blockedTrackTagKeys = new Set(["locura"]);
const canonicalTrackTagMap = new Map([
  ["рок", "rock"],
  ["трэп", "trap"],
  ["трэп метал", "trap metal"],
  ["трэп-метал", "trap metal"],
]);
const MIN_FUZZY_SEARCH_SCORE = 48;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SUPPLEMENTAL_PLAYLISTS = 10;
const MAX_GENRE_SUPPLEMENTAL_PLAYLISTS = 5;
const DAILY_PLAYLIST_TRACK_LIMIT = 12;
const GENRE_PLAYLIST_TRACK_LIMIT = 14;
let catalogCache = {
  value: null,
  expiresAt: 0,
};

function createPostgresConfig(env = process.env) {
  const connectionString = String(env.DATABASE_URL ?? "").trim();
  if (connectionString) {
    return { connectionString };
  }

  return {
    host: env.PGHOST ?? "127.0.0.1",
    port: Number(env.PGPORT ?? 5432),
    database: env.PGDATABASE ?? "music_app",
    user: env.PGUSER ?? "postgres",
    password: env.PGPASSWORD ?? "",
  };
}

export const pool = new Pool(createPostgresConfig());

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function normalizeArtistName(value = "") {
  return String(value).toLowerCase().trim();
}

export function normalizeTitle(value = "") {
  return String(value ?? "").trim();
}

function normalizeTrackTagKey(value = "") {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function canonicalizeTrackTag(value = "") {
  const trimmedTag = String(value ?? "").trim();
  const normalizedTagKey = normalizeTrackTagKey(trimmedTag);
  return canonicalTrackTagMap.get(normalizedTagKey) ?? trimmedTag;
}

function canonicalTrackTagSql(alias = "tt") {
  return `
    lower(
      case
        when lower(replace(${alias}.tag, '-', ' ')) = 'трэп метал' then 'trap metal'
        when lower(${alias}.tag) = 'трэп' then 'trap'
        when lower(${alias}.tag) = 'рок' then 'rock'
        else ${alias}.tag
      end
    )
  `;
}

function uniqueNonEmptyValues(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalizedValue = String(value ?? "").trim();
    if (!normalizedValue || seen.has(normalizedValue)) {
      continue;
    }
    seen.add(normalizedValue);
    result.push(normalizedValue);
  }
  return result;
}

function normalizeKnownGenreWords(value = "") {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[_-]+/g, " ")
    .replace(/(^|\s)т[рp][еэ]п(?=\s|$)/g, "$1trap")
    .replace(/(^|\s)метал+л?(?=\s|$)/g, "$1metal")
    .replace(/(^|\s)рок(?=\s|$)/g, "$1rock")
    .replace(/\s+/g, " ");
}

function normalizeFuzzySearchText(value = "") {
  return normalizeKnownGenreWords(canonicalizeTrackTag(value));
}

export function buildSearchQueryVariants(query = "") {
  const rawQuery = normalizeTitle(query).toLowerCase();
  return uniqueNonEmptyValues([
    rawQuery,
    normalizeTrackTagKey(rawQuery),
    normalizeTrackTagKey(canonicalizeTrackTag(rawQuery)),
    normalizeFuzzySearchText(rawQuery),
  ]);
}

function levenshteinDistance(left = "", right = "") {
  const leftLength = left.length;
  const rightLength = right.length;
  if (!leftLength) {
    return rightLength;
  }
  if (!rightLength) {
    return leftLength;
  }

  let previousRow = Array.from({ length: rightLength + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= leftLength; leftIndex += 1) {
    const currentRow = [leftIndex];
    for (let rightIndex = 1; rightIndex <= rightLength; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      currentRow[rightIndex] = Math.min(
        currentRow[rightIndex - 1] + 1,
        previousRow[rightIndex] + 1,
        previousRow[rightIndex - 1] + substitutionCost
      );
    }
    previousRow = currentRow;
  }

  return previousRow[rightLength];
}

function editSimilarity(left = "", right = "") {
  const maxLength = Math.max(left.length, right.length);
  if (!maxLength) {
    return 1;
  }
  return 1 - levenshteinDistance(left, right) / maxLength;
}

function tokenSimilarity(queryToken, fieldToken) {
  if (!queryToken || !fieldToken) {
    return 0;
  }
  if (queryToken === fieldToken) {
    return 1;
  }
  const shortestTokenLength = Math.min(queryToken.length, fieldToken.length);
  if (shortestTokenLength >= 3 && (fieldToken.startsWith(queryToken) || queryToken.startsWith(fieldToken))) {
    return 0.9;
  }
  if (shortestTokenLength >= 3 && (fieldToken.includes(queryToken) || queryToken.includes(fieldToken))) {
    return 0.78;
  }
  return editSimilarity(queryToken, fieldToken);
}

function fuzzySearchScore(query = "", field = "") {
  const normalizedQuery = normalizeFuzzySearchText(query);
  const normalizedField = normalizeFuzzySearchText(field);
  if (!normalizedQuery || !normalizedField) {
    return 0;
  }
  if (normalizedField.includes(normalizedQuery)) {
    return 100;
  }

  const queryTokens = normalizedQuery.split(/\s+/g).filter(Boolean);
  const fieldTokens = normalizedField.split(/\s+/g).filter(Boolean);
  if (!queryTokens.length || !fieldTokens.length) {
    return 0;
  }
  if (queryTokens.length === 1 && normalizedQuery.includes(normalizedField)) {
    return Math.max(55, Math.round((normalizedField.length / normalizedQuery.length) * 90));
  }

  const tokenScores = queryTokens.map((queryToken) =>
    fieldTokens.reduce((best, fieldToken) => Math.max(best, tokenSimilarity(queryToken, fieldToken)), 0)
  );
  const weakestTokenScore = Math.min(...tokenScores);
  if (queryTokens.length > 1 && weakestTokenScore < 0.72) {
    return 0;
  }

  const tokenScore = tokenScores.reduce((total, score) => total + score, 0) / queryTokens.length;

  return Math.round(Math.max(editSimilarity(normalizedQuery, normalizedField), tokenScore) * 100);
}

export function rankFuzzySearchItems(items = [], query = "", getFields = () => [], limit = 12) {
  return items
    .map((item) => {
      const fields = uniqueNonEmptyValues(getFields(item));
      const score = fields.reduce((best, field) => Math.max(best, fuzzySearchScore(query, field)), 0);
      return { item, score };
    })
    .filter(({ score }) => score >= MIN_FUZZY_SEARCH_SCORE)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ item }) => item);
}

export function sanitizeTrackTags(tags = []) {
  const safeTags = Array.isArray(tags) ? tags : [];
  const seen = new Set();
  const filteredTags = [];

  for (const tag of safeTags) {
    const canonicalTag = canonicalizeTrackTag(tag);
    const normalizedTagKey = normalizeTrackTagKey(canonicalTag);
    if (!normalizedTagKey || blockedTrackTagKeys.has(normalizedTagKey) || seen.has(normalizedTagKey)) {
      continue;
    }
    seen.add(normalizedTagKey);
    filteredTags.push(canonicalTag);
  }

  return filteredTags;
}

export function parseBooleanFlag(value, fallback = false) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

export function isDefaultCatalogSeedEnabled(env = process.env) {
  return parseBooleanFlag(env?.ENABLE_DEFAULT_CATALOG_SEED, false);
}

export function normalizePlaylistSubtitle(value = "") {
  const subtitle = normalizeTitle(value);
  if (LEGACY_CUSTOM_PLAYLIST_SUBTITLES.has(subtitle)) {
    return CUSTOM_PLAYLIST_SUBTITLE;
  }
  return subtitle;
}

export function includesText(text = "", query = "") {
  return String(text).toLowerCase().includes(String(query).toLowerCase());
}

export function isCustomPlaylistId(playlistId) {
  return String(playlistId).startsWith(USER_PLAYLIST_ID_PREFIX);
}

export function isSystemPlaylistId(playlistId) {
  return String(playlistId).startsWith(SYSTEM_PLAYLIST_ID_PREFIX);
}

export function isCustomPlaylist(playlist) {
  return Boolean(playlist?.isCustom) || isCustomPlaylistId(playlist?.id);
}

export function isSystemPlaylist(playlist) {
  return Boolean(playlist?.isSystem) || isSystemPlaylistId(playlist?.id);
}

export function compareBySeed(orderMap, leftId, rightId) {
  const leftSeed = orderMap.has(leftId) ? orderMap.get(leftId) : Number.MAX_SAFE_INTEGER;
  const rightSeed = orderMap.has(rightId) ? orderMap.get(rightId) : Number.MAX_SAFE_INTEGER;
  if (leftSeed !== rightSeed) {
    return leftSeed - rightSeed;
  }
  return String(leftId).localeCompare(String(rightId), "ru");
}

function playlistCoverIndex(seed) {
  const hash = Math.abs(
    String(seed)
      .split("")
      .reduce((acc, char) => acc * 31 + char.charCodeAt(0), 0)
  );
  return hash % customPlaylistCovers.length;
}

function coverKey(cover = "") {
  return String(cover ?? "").trim().toLowerCase();
}

function fallbackCoverForPlaylist(seed, usedCoverKeys = new Set()) {
  const startIndex = playlistCoverIndex(seed);
  for (let offset = 0; offset < customPlaylistCovers.length; offset += 1) {
    const cover = customPlaylistCovers[(startIndex + offset) % customPlaylistCovers.length];
    if (!usedCoverKeys.has(coverKey(cover))) {
      return cover;
    }
  }
  return customPlaylistCovers[startIndex];
}

export function coverForPlaylist(seed) {
  return customPlaylistCovers[playlistCoverIndex(seed)];
}

export function createAutoArtistId() {
  return `a-auto-${crypto.randomUUID()}`;
}

export function createReleaseId() {
  return `rel-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function resolveMediaFilePath(audioUrl) {
  const url = String(audioUrl ?? "").trim();
  if (!url.startsWith(mediaRoutePrefix)) {
    return null;
  }

  let relativePath = url.slice(mediaRoutePrefix.length);
  try {
    relativePath = decodeURIComponent(relativePath);
  } catch {
    return null;
  }

  const normalizedRelativePath = relativePath.replace(/^[/\\]+/, "");
  const resolvedMediaPath = path.resolve(mediaDirectory, normalizedRelativePath);
  const mediaRoot = path.resolve(mediaDirectory);
  const isInsideMediaRoot =
    resolvedMediaPath === mediaRoot || resolvedMediaPath.startsWith(`${mediaRoot}${path.sep}`);
  return isInsideMediaRoot ? resolvedMediaPath : null;
}

export function hlsManifestFilePathForTrack(trackId) {
  const normalizedTrackId = String(trackId ?? "").trim();
  if (!normalizedTrackId) {
    return null;
  }
  for (const manifestName of hlsManifestCandidates) {
    const manifestPath = path.resolve(hlsDirectory, normalizedTrackId, manifestName);
    if (fs.existsSync(manifestPath)) {
      return manifestPath;
    }
  }
  return path.resolve(hlsDirectory, normalizedTrackId, hlsManifestCandidates[0]);
}

export function hasHlsManifestForTrack(trackId) {
  const manifestPath = hlsManifestFilePathForTrack(trackId);
  if (!manifestPath) {
    return false;
  }
  return fs.existsSync(manifestPath);
}

export function hlsManifestUrlForTrack(trackId) {
  const normalizedTrackId = String(trackId ?? "").trim();
  if (!normalizedTrackId) {
    return "";
  }
  const manifestPath = hlsManifestFilePathForTrack(normalizedTrackId);
  const manifestName = manifestPath ? path.basename(manifestPath) : hlsManifestCandidates[0];
  return `${hlsRoutePrefix}${encodeURIComponent(normalizedTrackId)}/${encodeURIComponent(manifestName)}`;
}

export function playbackUrlForTrack(trackId, audioUrl) {
  const normalizedTrackId = String(trackId ?? "").trim();
  const normalizedAudioUrl = String(audioUrl ?? "").trim();
  if (!normalizedTrackId || !normalizedAudioUrl) {
    return normalizedAudioUrl;
  }

  if (resolveMediaFilePath(normalizedAudioUrl)) {
    if (!shouldEmbedSignedPlaybackUrl()) {
      return `${streamRoutePrefix}${encodeURIComponent(normalizedTrackId)}`;
    }
    return createSignedStreamUrl(normalizedTrackId, {
      basePath: streamRoutePrefix.slice(0, -1),
      ttlMs: getEmbeddedPlaybackUrlTtlMs(),
    }).url;
  }
  return normalizedAudioUrl;
}

export function isTrackAudioAvailable(trackId, audioUrl) {
  const normalizedTrackId = String(trackId ?? "").trim();
  const normalizedAudioUrl = String(audioUrl ?? "").trim();
  if (!normalizedTrackId || !normalizedAudioUrl) {
    return false;
  }

  const localMediaPath = resolveMediaFilePath(normalizedAudioUrl);
  if (!localMediaPath) {
    return true;
  }

  if (fs.existsSync(localMediaPath)) {
    return true;
  }

  return hasHlsManifestForTrack(normalizedTrackId);
}

export function mapTrackRow(row) {
  const rawAudioUrl = String(row.audioUrl ?? "").trim();
  const hasLocalAudio = Boolean(resolveMediaFilePath(rawAudioUrl));
  const hasHls = hasHlsManifestForTrack(row.id);

  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    durationSec: Number(row.durationSec ?? 0),
    explicit: Boolean(row.explicit),
    cover: row.cover,
    rawAudioUrl,
    isLocalAudio: hasLocalAudio,
    audioUrl: playbackUrlForTrack(row.id, rawAudioUrl),
    hlsUrl: hasHls ? hlsManifestUrlForTrack(row.id) : null,
    tags: sanitizeTrackTags(row.tags),
    createdAt: Number(row.createdAt ?? 0),
  };
}

export function trackHasArtist(track, artistName) {
  const normalizedArtistName = normalizeArtistName(artistName);
  return splitArtistNames(track.artist).some((candidateName) => normalizeArtistName(candidateName) === normalizedArtistName);
}

export function findArtistByName(artists, name) {
  const normalizedName = normalizeArtistName(name);
  return artists.find((artist) => normalizeArtistName(artist.name) === normalizedName) ?? null;
}

export function getPrimaryArtistForTrack(track, artists) {
  const [primaryArtistName = ""] = splitArtistNames(track.artist);
  return findArtistByName(artists, primaryArtistName);
}

function compareTracksByFreshness(left, right) {
  const createdAtDiff = Number(right?.createdAt ?? 0) - Number(left?.createdAt ?? 0);
  if (createdAtDiff !== 0) {
    return createdAtDiff;
  }
  return String(left?.title ?? left?.id ?? "").localeCompare(String(right?.title ?? right?.id ?? ""), "ru");
}

function playlistTrackSignature(trackIds = []) {
  return trackIds.join("|");
}

function trackCountWord(count) {
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
  return `${safeCount} ${trackCountWord(safeCount)}`;
}

function rotateTracksByDay(tracks = [], trackLimit = DAILY_PLAYLIST_TRACK_LIMIT) {
  const safeTracks = Array.isArray(tracks) ? tracks.filter((track) => track?.id) : [];
  if (!safeTracks.length) {
    return [];
  }

  const daySeed = Math.floor(Date.now() / DAY_MS);
  const startIndex = daySeed % safeTracks.length;
  const rotatedTracks = [...safeTracks.slice(startIndex), ...safeTracks.slice(0, startIndex)];
  return rotatedTracks.slice(0, Math.min(trackLimit, rotatedTracks.length));
}

function formatGenreLabel(tag = "") {
  return String(tag ?? "")
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

function slugifyPlaylistPart(value = "") {
  const normalizedValue = normalizeTrackTagKey(value)
    .replace(/[^a-zа-я0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return normalizedValue || "mix";
}

function summarizeGenresFromTracks(tracks = []) {
  const genreSummary = new Map();

  for (const track of tracks) {
    for (const tag of sanitizeTrackTags(track?.tags)) {
      const normalizedTagKey = normalizeTrackTagKey(tag);
      if (!normalizedTagKey) {
        continue;
      }

      const current = genreSummary.get(normalizedTagKey) ?? {
        label: canonicalizeTrackTag(tag),
        tracks: [],
        newestCreatedAt: 0,
      };
      if (!current.tracks.some((item) => item.id === track.id)) {
        current.tracks.push(track);
      }
      current.newestCreatedAt = Math.max(current.newestCreatedAt, Number(track.createdAt ?? 0));
      genreSummary.set(normalizedTagKey, current);
    }
  }

  return [...genreSummary.entries()]
    .map(([key, summary]) => ({
      key,
      label: formatGenreLabel(summary.label),
      tracks: summary.tracks.sort(compareTracksByFreshness),
      newestCreatedAt: summary.newestCreatedAt,
    }))
    .filter((summary) => summary.tracks.length >= 2)
    .sort(
      (left, right) =>
        right.tracks.length - left.tracks.length ||
        right.newestCreatedAt - left.newestCreatedAt ||
        left.label.localeCompare(right.label, "ru")
    )
    .slice(0, MAX_GENRE_SUPPLEMENTAL_PLAYLISTS);
}

function firstTrackCover(tracks = []) {
  for (const track of tracks) {
    const cover = String(track?.cover ?? "").trim();
    if (cover) {
      return cover;
    }
  }
  return "";
}

function choosePlaylistCover({
  playlistId,
  preferredTracks = [],
  fallbackTracks = [],
  usedCoverKeys = new Set(),
  allowUsedPreferredCover = false,
} = {}) {
  for (const track of preferredTracks) {
    const cover = String(track?.cover ?? "").trim();
    const key = coverKey(cover);
    if (cover && !usedCoverKeys.has(key)) {
      usedCoverKeys.add(key);
      return cover;
    }
  }

  if (allowUsedPreferredCover) {
    const preferredCover = firstTrackCover(preferredTracks);
    if (preferredCover) {
      usedCoverKeys.add(coverKey(preferredCover));
      return preferredCover;
    }
  }

  for (const track of fallbackTracks) {
    const cover = String(track?.cover ?? "").trim();
    const key = coverKey(cover);
    if (cover && !usedCoverKeys.has(key)) {
      usedCoverKeys.add(key);
      return cover;
    }
  }

  const fallbackCover = fallbackCoverForPlaylist(playlistId, usedCoverKeys);
  usedCoverKeys.add(coverKey(fallbackCover));
  return fallbackCover;
}

function topArtistFromTracks(tracks = []) {
  const artistSummary = new Map();

  for (const track of tracks) {
    for (const artistName of splitArtistNames(track.artist)) {
      const normalizedArtistName = normalizeArtistName(artistName);
      if (!normalizedArtistName) {
        continue;
      }

      const current = artistSummary.get(normalizedArtistName) ?? {
        label: artistName,
        trackIds: [],
      };

      if (!current.trackIds.includes(track.id)) {
        current.trackIds.push(track.id);
      }
      artistSummary.set(normalizedArtistName, current);
    }
  }

  return [...artistSummary.values()]
    .sort((left, right) => {
      const countDiff = right.trackIds.length - left.trackIds.length;
      if (countDiff !== 0) {
        return countDiff;
      }
      return String(left.label).localeCompare(String(right.label), "ru");
    })[0] ?? null;
}

function createSystemPlaylist({ id, title, subtitle, cover, trackIds }) {
  return {
    id,
    title,
    subtitle,
    cover: cover || coverForPlaylist(id),
    userId: null,
    isCustom: false,
    isSystem: true,
    isPublic: true,
    createdAt: 0,
    trackIds: Array.from(new Set((trackIds ?? []).filter(Boolean))),
  };
}

export function buildCatalogSupplementalPlaylists({ tracks = [], existingPlaylists = [] } = {}) {
  const availableTracks = Array.isArray(tracks) ? tracks.filter((track) => track?.id) : [];
  const existingPublicPlaylists = existingPlaylists.filter(
    (playlist) => !isCustomPlaylist(playlist) && !isSystemPlaylist(playlist) && (playlist.trackIds?.length ?? 0) > 0
  );

  if (!availableTracks.length) {
    return [];
  }

  const tracksByFreshness = [...availableTracks].sort(compareTracksByFreshness);
  const trackIdsByFreshness = tracksByFreshness.map((track) => track.id);
  const trackIdsReversed = [...trackIdsByFreshness].reverse();
  const dailyTracks = rotateTracksByDay(tracksByFreshness);
  const topArtist = topArtistFromTracks(tracksByFreshness);
  const genreSummaries = summarizeGenresFromTracks(tracksByFreshness);
  const usedCoverKeys = new Set(existingPublicPlaylists.map((playlist) => coverKey(playlist.cover)).filter(Boolean));

  const candidates = [
    {
      id: `${SYSTEM_PLAYLIST_ID_PREFIX}daily`,
      title: "Плейлист дня",
      subtitle: "Ежедневный микс по живым жанрам каталога",
      preferredTracks: dailyTracks,
      fallbackTracks: tracksByFreshness,
      trackIds: dailyTracks.map((track) => track.id),
    },
    {
      id: `${SYSTEM_PLAYLIST_ID_PREFIX}catalog-now`,
      title: "Сейчас в каталоге",
      subtitle: `${trackIdsByFreshness.length} доступных треков`,
      preferredTracks: tracksByFreshness,
      fallbackTracks: tracksByFreshness,
      trackIds: trackIdsByFreshness,
    },
    {
      id: `${SYSTEM_PLAYLIST_ID_PREFIX}rotation`,
      title: "Короткая ротация",
      subtitle: "Быстрый микс из того, что уже можно слушать",
      preferredTracks: tracksByFreshness.slice(1),
      fallbackTracks: tracksByFreshness,
      trackIds: trackIdsReversed,
    },
    {
      id: `${SYSTEM_PLAYLIST_ID_PREFIX}fresh`,
      title: "Свежие загрузки",
      subtitle: "Последние доступные треки",
      preferredTracks: tracksByFreshness,
      fallbackTracks: tracksByFreshness,
      trackIds: trackIdsByFreshness.slice(0, Math.min(trackIdsByFreshness.length, 8)),
    },
  ];

  for (const genreSummary of genreSummaries) {
    const trackIds = genreSummary.tracks
      .slice(0, Math.min(genreSummary.tracks.length, GENRE_PLAYLIST_TRACK_LIMIT))
      .map((track) => track.id);
    candidates.push({
      id: `${SYSTEM_PLAYLIST_ID_PREFIX}genre-${slugifyPlaylistPart(genreSummary.key)}`,
      title: `${genreSummary.label}: микс`,
      subtitle: `${formatTrackCount(trackIds.length)} по жанру`,
      preferredTracks: genreSummary.tracks,
      fallbackTracks: tracksByFreshness,
      trackIds,
    });
  }

  if (topArtist && topArtist.trackIds.length >= 2) {
    candidates.push({
      id: `${SYSTEM_PLAYLIST_ID_PREFIX}artist-focus`,
      title: `Фокус: ${topArtist.label}`,
      subtitle: "Подборка по самому наполненному артисту",
      preferredTracks: tracksByFreshness.filter((track) => topArtist.trackIds.includes(track.id)),
      fallbackTracks: tracksByFreshness,
      trackIds: topArtist.trackIds,
      allowUsedPreferredCover: true,
    });
  }

  const seenSignatures = new Set(
    existingPlaylists
      .filter((playlist) => Array.isArray(playlist.trackIds) && playlist.trackIds.length > 0)
      .map((playlist) => playlistTrackSignature(playlist.trackIds))
  );

  const supplementalPlaylists = [];
  for (const candidate of candidates) {
    const trackIds = Array.from(new Set((candidate.trackIds ?? []).filter(Boolean)));
    if (!trackIds.length) {
      continue;
    }

    const signature = playlistTrackSignature(trackIds);
    if (seenSignatures.has(signature)) {
      continue;
    }

    const playlist = createSystemPlaylist({
      ...candidate,
      cover: choosePlaylistCover({
        playlistId: candidate.id,
        preferredTracks: candidate.preferredTracks,
        fallbackTracks: candidate.fallbackTracks,
        usedCoverKeys,
        allowUsedPreferredCover: candidate.allowUsedPreferredCover,
      }),
      trackIds,
    });
    seenSignatures.add(signature);
    supplementalPlaylists.push(playlist);
  }

  return supplementalPlaylists.slice(0, MAX_SUPPLEMENTAL_PLAYLISTS);
}

export function sortTracks(tracks) {
  return [...tracks].sort((left, right) => {
    const leftIsSeedTrack = trackOrderMap.has(left.id);
    const rightIsSeedTrack = trackOrderMap.has(right.id);
    if (leftIsSeedTrack || rightIsSeedTrack) {
      return compareBySeed(trackOrderMap, left.id, right.id);
    }
    return compareTracksByFreshness(left, right);
  });
}

export function sortArtists(artists) {
  return [...artists].sort((left, right) => compareBySeed(artistOrderMap, left.id, right.id));
}

function artistSummarySelect(alias = "a") {
  const artistId = `${alias}.id`;
  return `
    ${artistId} as id,
    ${alias}.name as name,
    coalesce(
      (
        select count(*)::int
        from user_states us
        where ${artistId} = any(coalesce(us.followed_artist_ids, array[]::text[]))
      ),
      0
    ) as followers,
    coalesce(
      (
        select count(distinct us.user_id)::int
        from user_states us
        join track_artists listener_ta on listener_ta.artist_id = ${artistId}
        where listener_ta.track_id = any(coalesce(us.history_track_ids, array[]::text[]))
      ),
      0
    ) as listeners,
    coalesce(
      (
        select r.cover
        from releases r
        where r.artist_id = ${artistId}
          and coalesce(nullif(r.status, ''), 'published') = 'published'
        order by coalesce(r.published_at, r.created_at, 0) desc, r.year desc, r.title
        limit 1
      ),
      (
        select t.cover
        from track_artists cover_ta
        join tracks t on t.id = cover_ta.track_id
        where cover_ta.artist_id = ${artistId}
          and coalesce(t.is_hidden, false) = false
        order by coalesce(t.created_at, 0) desc, t.title
        limit 1
      ),
      ''
    ) as avatar
  `;
}

function mapArtistRow(row) {
  const avatar = String(row.avatar ?? row.avatarUrl ?? row.cover ?? "").trim();
  return {
    id: row.id,
    name: row.name,
    followers: Math.max(0, Number(row.followers ?? 0)),
    listeners: Math.max(0, Number(row.listeners ?? 0)),
    avatar,
    avatarUrl: avatar,
    cover: avatar,
  };
}

export function sortPlaylists(playlists) {
  const basePlaylists = playlists
    .filter((playlist) => !isCustomPlaylist(playlist))
    .sort((left, right) => compareBySeed(playlistOrderMap, left.id, right.id));
  const customPlaylists = playlists
    .filter((playlist) => isCustomPlaylist(playlist))
    .sort((left, right) => (Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0)) || left.id.localeCompare(right.id));
  return [...basePlaylists, ...customPlaylists];
}

export function uniqueTrackIds(trackIds = [], trackMap = {}) {
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

export function invalidateCatalogCache() {
  catalogCache = {
    value: null,
    expiresAt: 0,
  };
}

export function createUserPlaylistId() {
  return `${USER_PLAYLIST_ID_PREFIX}${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureSchema() {
  throw new Error("ensureSchema is deprecated. Use \"npm run db:migrate\" and \"npm run db:seed\".");
}

export async function seedCatalogIfEmpty() {
  const seededTrackCreatedAt = Date.now();

  await withTransaction(async (client) => {
    for (const artist of seedArtists) {
      await client.query(
        `insert into artists (id, name, followers)
         values ($1, $2, $3)
         on conflict (id) do update
           set name = excluded.name,
               followers = excluded.followers;`,
        [artist.id, artist.name, artist.followers]
      );
    }

    for (const track of seedTracks) {
      await client.query(
        `insert into tracks (id, title, duration_sec, explicit, cover, audio_url, created_at)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (id) do update
           set title = excluded.title,
               duration_sec = excluded.duration_sec,
               explicit = excluded.explicit,
               cover = excluded.cover,
               audio_url = excluded.audio_url,
               created_at = coalesce(tracks.created_at, excluded.created_at);`,
        [track.id, track.title, track.durationSec, track.explicit, track.cover, track.audioUrl ?? null, seededTrackCreatedAt]
      );

      const trackArtistNames = splitArtistNames(track.artist);
      for (let index = 0; index < trackArtistNames.length; index += 1) {
        const artistName = trackArtistNames[index];
        const artistId = artistNameMap.get(normalizeArtistName(artistName));
        if (!artistId) {
          continue;
        }

        await client.query(
          `insert into track_artists (track_id, artist_id, artist_order)
           values ($1, $2, $3)
           on conflict (track_id, artist_id) do update
             set artist_order = excluded.artist_order;`,
          [track.id, artistId, index + 1]
        );
      }

      for (const tag of sanitizeTrackTags(track.tags)) {
        await client.query(
          `insert into track_tags (track_id, tag)
           values ($1, $2)
           on conflict (track_id, tag) do nothing;`,
          [track.id, tag]
        );
      }
    }

    for (const playlist of seedPlaylists) {
      await client.query(
        `insert into playlists (id, title, subtitle, cover, is_custom)
         values ($1, $2, $3, $4, false)
         on conflict (id) do update
           set title = excluded.title,
               subtitle = excluded.subtitle,
               cover = excluded.cover;`,
        [playlist.id, playlist.title, playlist.subtitle, playlist.cover]
      );

      for (let index = 0; index < playlist.trackIds.length; index += 1) {
        await client.query(
          `insert into playlist_tracks (playlist_id, track_id, position)
           values ($1, $2, $3)
           on conflict (playlist_id, position) do update
             set track_id = excluded.track_id;`,
          [playlist.id, playlist.trackIds[index], index + 1]
        );
      }
    }
  });
}

export async function syncTrackAudioUrls() {
  await withTransaction(async (client) => {
    for (const track of seedTracks) {
      await client.query(
        `
        update tracks
        set title = $2,
            duration_sec = $3,
            explicit = $4,
            cover = $5,
            audio_url = $6
        where id = $1
          and (
            title is distinct from $2
            or duration_sec is distinct from $3
            or explicit is distinct from $4
            or cover is distinct from $5
            or audio_url is distinct from $6
          );
      `,
        [track.id, track.title, track.durationSec, track.explicit, track.cover, track.audioUrl ?? null]
      );
    }
  });
}

export async function syncTrackArtists() {
  await withTransaction(async (client) => {
    const { rows: existingArtists } = await client.query(`
      select id, name
      from artists;
    `);
    const artistIdsByName = new Map(
      existingArtists
        .map((artist) => [normalizeArtistName(artist.name), artist.id])
        .filter(([name, id]) => Boolean(name) && Boolean(id))
    );

    for (const track of seedTracks) {
      const artistNames = splitArtistNames(track.artist);
      const orderedArtistIds = [];

      for (const artistName of artistNames) {
        const normalizedName = normalizeArtistName(artistName);
        if (!normalizedName) {
          continue;
        }

        let artistId = artistIdsByName.get(normalizedName) ?? null;
        if (!artistId) {
          const generatedArtistId = createAutoArtistId();
          await client.query(
            `
            insert into artists (id, name, followers)
            values ($1, $2, $3)
            on conflict (name) do nothing;
          `,
            [generatedArtistId, artistName, "0"]
          );

          const { rows: matchedArtists } = await client.query(
            `
            select id
            from artists
            where name = $1
            limit 1;
          `,
            [artistName]
          );
          artistId = matchedArtists[0]?.id ?? null;
          if (!artistId) {
            continue;
          }
          artistIdsByName.set(normalizedName, artistId);
        }

        if (!orderedArtistIds.includes(artistId)) {
          orderedArtistIds.push(artistId);
        }
      }

      await client.query(
        `
        delete from track_artists
        where track_id = $1;
      `,
        [track.id]
      );

      for (let index = 0; index < orderedArtistIds.length; index += 1) {
        await client.query(
          `
          insert into track_artists (track_id, artist_id, artist_order)
          values ($1, $2, $3)
          on conflict (track_id, artist_id) do update
            set artist_order = excluded.artist_order;
        `,
          [track.id, orderedArtistIds[index], index + 1]
        );
      }
    }
  });
}

export async function validateCatalogAudioFiles({
  strictMissingFiles = parseBooleanFlag(process.env.STRICT_AUDIO_VALIDATION, false),
} = {}) {
  const { rows } = await pool.query(`
    select
      t.id,
      t.audio_url as "audioUrl"
    from tracks t
    order by t.id;
  `);

  const missingAudioUrl = [];
  const missingFiles = [];
  const invalidLocalUrls = [];

  for (const row of rows) {
    const trackId = String(row.id ?? "").trim();
    const audioUrl = String(row.audioUrl ?? "").trim();

    if (!audioUrl) {
      missingAudioUrl.push(trackId);
      continue;
    }

    const localMediaPath = resolveMediaFilePath(audioUrl);
    if (!localMediaPath) {
      if (audioUrl.startsWith("/api/media")) {
        invalidLocalUrls.push(`${trackId} -> ${audioUrl}`);
      }
      continue;
    }

    if (!fs.existsSync(localMediaPath)) {
      missingFiles.push(`${trackId} -> ${audioUrl}`);
    }
  }

  if (!missingAudioUrl.length && !missingFiles.length && !invalidLocalUrls.length) {
    return {
      totalTracks: rows.length,
      missingAudioUrl,
      missingFiles,
      invalidLocalUrls,
      strictMissingFiles,
      ok: true,
      hasWarnings: false,
    };
  }

  const details = [];
  if (missingAudioUrl.length) {
    details.push(`missing audioUrl: ${missingAudioUrl.join(", ")}`);
  }
  if (missingFiles.length && strictMissingFiles) {
    details.push(`missing files: ${missingFiles.join(", ")}`);
  }
  if (invalidLocalUrls.length) {
    details.push(`invalid local URLs: ${invalidLocalUrls.join(", ")}`);
  }

  if (details.length) {
    throw new Error(`Audio catalog validation failed (${rows.length} tracks): ${details.join("; ")}`);
  }

  return {
    totalTracks: rows.length,
    missingAudioUrl,
    missingFiles,
    invalidLocalUrls,
    strictMissingFiles,
    ok: true,
    hasWarnings: missingFiles.length > 0,
  };
}

export async function seedReleasesIfEmpty() {
  const { rows } = await pool.query("select count(*)::int as count from releases;");
  if (Number(rows[0]?.count ?? 0) > 0) {
    return false;
  }

  await withTransaction(async (client) => {
    for (const release of artistReleases) {
      const releaseTimestamp = Date.UTC(Number(release.year ?? new Date().getUTCFullYear()), 0, 1);
      await client.query(
        `insert into releases (id, artist_id, title, type, year, cover, status, created_at, published_at)
         values ($1, $2, $3, $4, $5, $6, 'published', $7, $8)
         on conflict (id) do update
           set artist_id = excluded.artist_id,
               title = excluded.title,
               type = excluded.type,
               year = excluded.year,
               cover = excluded.cover,
               status = 'published',
               published_at = excluded.published_at;`,
        [release.id, release.artistId, release.title, release.type, release.year, release.cover, releaseTimestamp, releaseTimestamp]
      );

      for (let index = 0; index < release.trackIds.length; index += 1) {
        await client.query(
          `insert into release_tracks (release_id, track_id, position)
           values ($1, $2, $3)
           on conflict (release_id, position) do update
             set track_id = excluded.track_id;`,
          [release.id, release.trackIds[index], index + 1]
        );
      }
    }
  });

  return true;
}

export async function fetchArtists() {
  const { rows } = await pool.query(`
    select
      ${artistSummarySelect("a")}
    from artists a;
  `);
  return sortArtists(rows.map(mapArtistRow));
}

export async function fetchTracks() {
  const { rows } = await pool.query(`
    select
      t.id,
      t.title,
      t.duration_sec as "durationSec",
      t.explicit,
      t.cover,
      t.audio_url as "audioUrl",
      coalesce(t.created_at, 0) as "createdAt",
      coalesce(
        (
          select string_agg(a.name, ', ' order by ta.artist_order)
          from track_artists ta
          join artists a on a.id = ta.artist_id
          where ta.track_id = t.id
        ),
        ''
      ) as artist,
      coalesce(
        (
          select array_agg(tt.tag order by tt.tag)
          from track_tags tt
          where tt.track_id = t.id
        ),
        array[]::text[]
      ) as tags
    from tracks t
    where coalesce(t.is_hidden, false) = false;
  `);

  const tracks = rows
    .filter((row) => isTrackAudioAvailable(row.id, row.audioUrl))
    .map((row) => mapTrackRow(row));

  return sortTracks(tracks);
}

export async function fetchPlaylists() {
  const { rows } = await pool.query(`
    select
      p.id,
      p.title,
      p.subtitle,
      p.cover,
      p.user_id as "userId",
      coalesce(p.is_custom, false) as "isCustom",
      coalesce(p.is_public, false) as "isPublic",
      coalesce(p.created_at, 0) as "createdAt",
      coalesce(
        (
          select array_agg(pt.track_id order by pt.position)
          from playlist_tracks pt
          where pt.playlist_id = p.id
        ),
        array[]::text[]
      ) as "trackIds"
    from playlists p;
  `);

  const playlists = rows.map((row) => ({
    id: row.id,
    title: row.title,
    subtitle: normalizePlaylistSubtitle(row.subtitle),
    cover: row.cover,
    userId: row.userId ?? null,
    isCustom: Boolean(row.isCustom) || isCustomPlaylistId(row.id),
    isPublic: !(Boolean(row.isCustom) || isCustomPlaylistId(row.id)) || Boolean(row.isPublic),
    createdAt: Number(row.createdAt ?? 0),
    trackIds: Array.isArray(row.trackIds) ? row.trackIds : [],
  }));

  return sortPlaylists(playlists);
}

export async function fetchReleases({ includeDrafts = false } = {}) {
  const { rows } = await pool.query(`
    select
      r.id,
      r.artist_id as "artistId",
      r.title,
      r.type,
      r.year,
      r.cover,
      coalesce(r.description, '') as description,
      coalesce(nullif(r.status, ''), 'published') as status,
      coalesce(r.created_at, 0) as "createdAt",
      coalesce(r.published_at, 0) as "publishedAt",
      coalesce(
        (
          select array_agg(rt.track_id order by rt.position)
          from release_tracks rt
          where rt.release_id = r.id
        ),
        array[]::text[]
      ) as "trackIds"
    from releases r;
  `);

  return rows
    .map((row) => ({
    id: row.id,
    artistId: row.artistId,
    title: row.title,
    type: row.type,
    year: Number(row.year),
    cover: row.cover,
    description: row.description,
    status: row.status,
    createdAt: Number(row.createdAt ?? 0),
    publishedAt: Number(row.publishedAt ?? 0),
    trackIds: Array.isArray(row.trackIds) ? row.trackIds : [],
  }))
    .filter((release) => includeDrafts || release.status === "published")
    .sort(
      (first, second) =>
        Number(second.publishedAt ?? 0) - Number(first.publishedAt ?? 0) ||
        Number(second.year ?? 0) - Number(first.year ?? 0) ||
        String(first.title ?? "").localeCompare(String(second.title ?? ""), "ru")
    );
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

function hasSearchResultItems(result = {}) {
  return Boolean(
    result.tracks?.length ||
      result.playlists?.length ||
      result.artists?.length ||
      result.albums?.length
  );
}

function buildFuzzySearchResult({
  catalog,
  query,
  normalizedFilter,
  limit,
  offset,
} = {}) {
  const includeTracks = normalizedFilter === "all" || normalizedFilter === "tracks";
  const includePlaylists = normalizedFilter === "all" || normalizedFilter === "playlists";
  const includeArtists = normalizedFilter === "all" || normalizedFilter === "artists";
  const includeAlbums = normalizedFilter === "all" || normalizedFilter === "albums";
  const trackMap = catalog?.trackMap ?? Object.fromEntries((catalog?.tracks ?? []).map((track) => [track.id, track]));

  const tracks = includeTracks
    ? rankFuzzySearchItems(
        catalog?.tracks ?? [],
        query,
        (track) => [track.title, track.artist, ...(Array.isArray(track.tags) ? track.tags : [])],
        limit
      )
    : [];

  const playlists = includePlaylists
    ? rankFuzzySearchItems(
        catalog?.playlists ?? [],
        query,
        (playlist) => [
          playlist.title,
          normalizePlaylistSubtitle(playlist.subtitle),
          ...(playlist.trackIds ?? []).flatMap((trackId) => {
            const track = trackMap[trackId];
            return track ? [track.title, track.artist, ...(Array.isArray(track.tags) ? track.tags : [])] : [];
          }),
        ],
        limit
      )
    : [];

  const artists = includeArtists
    ? rankFuzzySearchItems(catalog?.artists ?? [], query, (artist) => [artist.name], limit)
    : [];

  const albums = includeAlbums
    ? rankFuzzySearchItems(
        catalog?.releases ?? [],
        query,
        (release) => [
          release.title,
          release.artistName,
          release.type,
          release.year,
          ...(release.trackIds ?? []).flatMap((trackId) => {
            const track = trackMap[trackId];
            return track ? [track.title, track.artist, ...(Array.isArray(track.tags) ? track.tags : [])] : [];
          }),
        ],
        limit
      )
    : [];

  return {
    tracks,
    playlists,
    artists,
    albums,
    pagination: {
      limit,
      offset,
      hasMore: false,
      nextOffset: null,
      tracksHasMore: false,
      playlistsHasMore: false,
      artistsHasMore: false,
      albumsHasMore: false,
      fuzzy: true,
    },
  };
}

export async function searchCatalogInDatabase({
  query,
  filter = "all",
  limit = 12,
  offset = 0,
} = {}) {
  const normalizedQuery = normalizeTitle(query).toLowerCase();
  const normalizedFilter = normalizeTitle(filter).toLowerCase() || "all";
  const safeLimit = clampInteger(limit, 12, 1, 50);
  const safeOffset = clampInteger(offset, 0, 0, 10_000);
  const queryVariants = buildSearchQueryVariants(normalizedQuery);

  if (!queryVariants.length) {
    return {
      tracks: [],
      playlists: [],
      artists: [],
      albums: [],
      pagination: {
        limit: safeLimit,
        offset: safeOffset,
        hasMore: false,
        nextOffset: null,
      },
    };
  }

  const patterns = queryVariants.map((queryVariant) => `%${queryVariant}%`);
  const limitPlusOne = safeLimit + 1;
  const trackLimitWithBuffer = safeLimit * 4 + 1;
  const includeTracks = normalizedFilter === "all" || normalizedFilter === "tracks";
  const includePlaylists = normalizedFilter === "all" || normalizedFilter === "playlists";
  const includeArtists = normalizedFilter === "all" || normalizedFilter === "artists";
  const includeAlbums = normalizedFilter === "all" || normalizedFilter === "albums";
  const catalog = includePlaylists || includeAlbums ? await fetchCatalog() : null;
  const visibleTrackIdSet = new Set(catalog?.tracks?.map((track) => track.id) ?? []);
  const visibleReleaseIdSet = new Set(catalog?.releases?.map((release) => release.id) ?? []);

  let rawTracks = [];
  let rawPlaylists = [];
  let rawArtists = [];
  let rawAlbums = [];

  if (includeTracks) {
    const { rows } = await pool.query(
      `
      select
        t.id,
        t.title,
        t.duration_sec as "durationSec",
        t.explicit,
        t.cover,
        t.audio_url as "audioUrl",
        coalesce(
          (
            select string_agg(a.name, ', ' order by ta.artist_order)
            from track_artists ta
            join artists a on a.id = ta.artist_id
            where ta.track_id = t.id
          ),
          ''
        ) as artist,
        coalesce(
          (
            select array_agg(tt.tag order by tt.tag)
            from track_tags tt
            where tt.track_id = t.id
          ),
          array[]::text[]
        ) as tags
      from tracks t
      where
        coalesce(t.is_hidden, false) = false
        and (
          lower(t.title) like any($1::text[])
        or exists (
          select 1
          from track_tags tt
          where tt.track_id = t.id
            and ${canonicalTrackTagSql("tt")} like any($1::text[])
        )
        or exists (
          select 1
          from track_artists ta
          join artists a on a.id = ta.artist_id
          where ta.track_id = t.id
            and lower(a.name) like any($1::text[])
        )
        )
      order by t.title
      limit $2
      offset $3;
    `,
      [patterns, trackLimitWithBuffer, safeOffset]
    );
    rawTracks = rows;
  }

  if (includePlaylists) {
    const { rows } = await pool.query(
      `
      select
        p.id,
        p.title,
        p.subtitle,
        p.cover,
        p.user_id as "userId",
        coalesce(p.is_custom, false) as "isCustom",
        coalesce(p.is_public, false) as "isPublic",
        coalesce(p.created_at, 0) as "createdAt",
        coalesce(
          (
            select array_agg(pt.track_id order by pt.position)
            from playlist_tracks pt
            where pt.playlist_id = p.id
          ),
          array[]::text[]
        ) as "trackIds"
      from playlists p
      where
        lower(p.title) like any($1::text[])
        or lower(coalesce(p.subtitle, '')) like any($1::text[])
        or exists (
          select 1
          from playlist_tracks pt
          join track_tags tt on tt.track_id = pt.track_id
          where pt.playlist_id = p.id
            and ${canonicalTrackTagSql("tt")} like any($1::text[])
        )
      order by p.title
      limit $2
      offset $3;
    `,
      [patterns, limitPlusOne, safeOffset]
    );
    rawPlaylists = rows;
  }

  if (includeArtists) {
    const { rows } = await pool.query(
      `
      select
        ${artistSummarySelect("a")}
      from artists a
      where lower(a.name) like any($1::text[])
         or exists (
           select 1
           from track_artists ta
           join track_tags tt on tt.track_id = ta.track_id
           where ta.artist_id = a.id
             and ${canonicalTrackTagSql("tt")} like any($1::text[])
         )
      order by a.name
      limit $2
      offset $3;
    `,
      [patterns, limitPlusOne, safeOffset]
    );
    rawArtists = rows;
  }

  if (includeAlbums) {
    const { rows } = await pool.query(
      `
      select
        r.id,
        r.artist_id as "artistId",
        r.title,
        r.type,
        r.year,
        r.cover,
        a.name as "artistName",
        coalesce(
          (
            select array_agg(rt.track_id order by rt.position)
            from release_tracks rt
            where rt.release_id = r.id
          ),
          array[]::text[]
        ) as "trackIds"
      from releases r
      join artists a on a.id = r.artist_id
      where
        coalesce(nullif(r.status, ''), 'published') = 'published'
        and (
          lower(r.title) like any($1::text[])
        or lower(a.name) like any($1::text[])
        or exists (
          select 1
          from release_tracks rt
          join track_tags tt on tt.track_id = rt.track_id
          where rt.release_id = r.id
            and ${canonicalTrackTagSql("tt")} like any($1::text[])
        )
        )
      order by coalesce(r.published_at, r.created_at, 0) desc, r.year desc, r.title
      limit $2
      offset $3;
    `,
      [patterns, limitPlusOne, safeOffset]
    );
    rawAlbums = rows;
  }

  const filteredTracks = rawTracks.filter((row) => isTrackAudioAvailable(row.id, row.audioUrl));
  const tracksHasMore = filteredTracks.length > safeLimit || rawTracks.length >= trackLimitWithBuffer;
  const playlistsHasMore = rawPlaylists.length > safeLimit;
  const artistsHasMore = rawArtists.length > safeLimit;
  const albumsHasMore = rawAlbums.length > safeLimit;
  const hasMore = tracksHasMore || playlistsHasMore || artistsHasMore || albumsHasMore;

  const tracks = filteredTracks.slice(0, safeLimit).map((row) => mapTrackRow(row));

  const playlists = rawPlaylists.slice(0, safeLimit).map((row) => ({
    id: row.id,
    title: row.title,
    subtitle: normalizePlaylistSubtitle(row.subtitle),
    cover: row.cover,
    userId: row.userId ?? null,
    isCustom: Boolean(row.isCustom) || isCustomPlaylistId(row.id),
    isPublic: !(Boolean(row.isCustom) || isCustomPlaylistId(row.id)) || Boolean(row.isPublic),
    createdAt: Number(row.createdAt ?? 0),
    trackIds: Array.isArray(row.trackIds) ? row.trackIds : [],
  }))
    .filter((playlist) => playlist.isCustom || playlist.trackIds.some((trackId) => visibleTrackIdSet.has(trackId)));

  const artists = rawArtists.slice(0, safeLimit).map(mapArtistRow);

  const albums = rawAlbums.slice(0, safeLimit).map((row) => ({
    id: row.id,
    artistId: row.artistId,
    title: row.title,
    type: row.type,
    year: Number(row.year ?? 0),
    cover: row.cover,
    artistName: row.artistName,
    trackIds: Array.isArray(row.trackIds) ? row.trackIds : [],
  }))
    .filter((album) => visibleReleaseIdSet.has(album.id));

  const result = {
    tracks,
    playlists,
    artists,
    albums,
    pagination: {
      limit: safeLimit,
      offset: safeOffset,
      hasMore,
      nextOffset: hasMore ? safeOffset + safeLimit : null,
      tracksHasMore,
      playlistsHasMore,
      artistsHasMore,
      albumsHasMore,
    },
  };

  if (safeOffset > 0 || hasSearchResultItems(result)) {
    return result;
  }

  const fuzzyCatalog = catalog ?? await fetchCatalog();
  const fuzzyResult = buildFuzzySearchResult({
    catalog: fuzzyCatalog,
    query: normalizedQuery,
    normalizedFilter,
    limit: safeLimit,
    offset: safeOffset,
  });

  return hasSearchResultItems(fuzzyResult) ? fuzzyResult : result;
}

export async function fetchCatalog() {
  const now = Date.now();
  if (catalogCache.value && catalogCache.expiresAt > now) {
    return catalogCache.value;
  }

  const [artists, tracks, playlists, releases] = await Promise.all([
    fetchArtists(),
    fetchTracks(),
    fetchPlaylists(),
    fetchReleases(),
  ]);

  const trackMap = Object.fromEntries(tracks.map((track) => [track.id, track]));
  const playlistsWithValidTracks = playlists.map((playlist) => ({
    ...playlist,
    trackIds: uniqueTrackIds(playlist.trackIds, trackMap),
  }));
  const playablePlaylists = playlistsWithValidTracks.filter(
    (playlist) => playlist.trackIds.length > 0 || isCustomPlaylist(playlist)
  );
  const supplementalPlaylists = buildCatalogSupplementalPlaylists({
    tracks,
    existingPlaylists: playablePlaylists,
  });
  const releasesWithValidTracks = releases.map((release) => ({
    ...release,
    trackIds: uniqueTrackIds(release.trackIds, trackMap),
  }))
    .filter((release) => release.trackIds.length > 0);

  const catalog = {
    artists,
    tracks,
    trackMap,
    playlists: sortPlaylists([...playablePlaylists, ...supplementalPlaylists]),
    releases: releasesWithValidTracks,
  };

  catalogCache = {
    value: catalog,
    expiresAt: now + CATALOG_CACHE_TTL_MS,
  };

  return catalog;
}

export async function getPlaylistById(playlistId) {
  const { rows } = await pool.query(
    `
    select
      p.id,
      p.title,
      p.subtitle,
      p.cover,
      p.user_id as "userId",
      coalesce(p.is_custom, false) as "isCustom",
      coalesce(p.is_public, false) as "isPublic",
      coalesce(p.created_at, 0) as "createdAt",
      coalesce(
        (
          select array_agg(pt.track_id order by pt.position)
          from playlist_tracks pt
          where pt.playlist_id = p.id
        ),
        array[]::text[]
      ) as "trackIds"
    from playlists p
    where p.id = $1
    limit 1;
  `,
    [playlistId]
  );

  if (!rows.length) {
    return null;
  }

  const row = rows[0];
  return {
    id: row.id,
    title: row.title,
    subtitle: normalizePlaylistSubtitle(row.subtitle),
    cover: row.cover,
    userId: row.userId ?? null,
    isCustom: Boolean(row.isCustom) || isCustomPlaylistId(row.id),
    isPublic: !(Boolean(row.isCustom) || isCustomPlaylistId(row.id)) || Boolean(row.isPublic),
    createdAt: Number(row.createdAt ?? 0),
    trackIds: Array.isArray(row.trackIds) ? row.trackIds : [],
  };
}

export async function assertCatalogSchemaReady() {
  const requiredTables = [
    "artists",
    "tracks",
    "track_artists",
    "track_tags",
    "playlists",
    "playlist_tracks",
    "releases",
    "release_tracks",
    "users",
    "user_sessions",
    "user_states",
    "password_reset_tokens",
  ];

  const { rows } = await pool.query(
    `
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name = any($1::text[]);
  `,
    [requiredTables]
  );

  const existing = new Set(rows.map((row) => String(row.table_name ?? "")));
  const missing = requiredTables.filter((tableName) => !existing.has(tableName));

  if (!missing.length) {
    return;
  }

  throw new Error(
    `Database schema is not initialized (missing: ${missing.join(", ")}). Run "npm run db:migrate" and "npm run db:seed".`
  );
}

export async function runCatalogSeed() {
  const defaultCatalogSeedEnabled = isDefaultCatalogSeedEnabled();
  if (defaultCatalogSeedEnabled) {
    await seedCatalogIfEmpty();
    await syncTrackAudioUrls();
    await syncTrackArtists();
    await seedReleasesIfEmpty();
  }
  invalidateCatalogCache();
  return {
    defaultCatalogSeedEnabled,
  };
}

export async function cleanupDefaultCatalogSeed() {
  const cleanupSummary = await withTransaction(async (client) => {
    const deletedReleases = await client.query(
      `
      delete from releases
      where id = any($1::text[])
      returning id;
    `,
      [defaultSeedReleaseIds]
    );

    const deletedPlaylists = await client.query(
      `
      delete from playlists
      where id = any($1::text[])
        and coalesce(is_custom, false) = false
      returning id;
    `,
      [defaultSeedPlaylistIds]
    );

    const deletedTracks = await client.query(
      `
      delete from tracks
      where id = any($1::text[])
      returning id;
    `,
      [defaultSeedTrackIds]
    );

    const deletedArtists = await client.query(
      `
      delete from artists
      where id = any($1::text[])
        and not exists (
          select 1
          from track_artists
          where track_artists.artist_id = artists.id
        )
        and not exists (
          select 1
          from releases
          where releases.artist_id = artists.id
        )
      returning id;
    `,
      [defaultSeedArtistIds]
    );

    return {
      deletedReleases: deletedReleases.rowCount,
      deletedPlaylists: deletedPlaylists.rowCount,
      deletedTracks: deletedTracks.rowCount,
      deletedArtists: deletedArtists.rowCount,
    };
  });

  invalidateCatalogCache();
  return cleanupSummary;
}

export async function closePool() {
  await pool.end();
}
