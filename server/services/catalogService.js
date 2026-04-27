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
export const DEFAULT_ERROR_MESSAGE = "Failed to load data. Please refresh the page.";
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
let catalogCache = {
  value: null,
  expiresAt: 0,
};

export const pool = new Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? "music_app",
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD ?? "",
});

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
  return String(value ?? "").trim().toLowerCase();
}

export function sanitizeTrackTags(tags = []) {
  const safeTags = Array.isArray(tags) ? tags : [];
  const seen = new Set();
  const filteredTags = [];

  for (const tag of safeTags) {
    const trimmedTag = String(tag ?? "").trim();
    const normalizedTagKey = normalizeTrackTagKey(trimmedTag);
    if (!normalizedTagKey || blockedTrackTagKeys.has(normalizedTagKey) || seen.has(normalizedTagKey)) {
      continue;
    }
    seen.add(normalizedTagKey);
    filteredTags.push(trimmedTag);
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

export function coverForPlaylist(seed) {
  const hash = Math.abs(
    String(seed)
      .split("")
      .reduce((acc, char) => acc * 31 + char.charCodeAt(0), 0)
  );
  return customPlaylistCovers[hash % customPlaylistCovers.length];
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

  if (!availableTracks.length || existingPublicPlaylists.length >= 3) {
    return [];
  }

  const tracksByFreshness = [...availableTracks].sort(compareTracksByFreshness);
  const trackIdsByFreshness = tracksByFreshness.map((track) => track.id);
  const trackIdsReversed = [...trackIdsByFreshness].reverse();
  const topArtist = topArtistFromTracks(tracksByFreshness);

  const candidates = [
    createSystemPlaylist({
      id: `${SYSTEM_PLAYLIST_ID_PREFIX}catalog-now`,
      title: "Сейчас в каталоге",
      subtitle: `${trackIdsByFreshness.length} доступных треков`,
      cover: tracksByFreshness[0]?.cover,
      trackIds: trackIdsByFreshness,
    }),
    createSystemPlaylist({
      id: `${SYSTEM_PLAYLIST_ID_PREFIX}rotation`,
      title: "Короткая ротация",
      subtitle: "Быстрый микс из того, что уже можно слушать",
      cover: tracksByFreshness[Math.min(1, tracksByFreshness.length - 1)]?.cover ?? tracksByFreshness[0]?.cover,
      trackIds: trackIdsReversed,
    }),
    createSystemPlaylist({
      id: `${SYSTEM_PLAYLIST_ID_PREFIX}fresh`,
      title: "Свежие загрузки",
      subtitle: "Последние доступные треки",
      cover: tracksByFreshness[0]?.cover,
      trackIds: trackIdsByFreshness.slice(0, Math.min(trackIdsByFreshness.length, 8)),
    }),
  ];

  if (topArtist && topArtist.trackIds.length >= 2) {
    candidates.push(
      createSystemPlaylist({
        id: `${SYSTEM_PLAYLIST_ID_PREFIX}artist-focus`,
        title: `Фокус: ${topArtist.label}`,
        subtitle: "Подборка по самому наполненному артисту",
        cover: tracksByFreshness.find((track) => topArtist.trackIds.includes(track.id))?.cover,
        trackIds: topArtist.trackIds,
      })
    );
  }

  const seenSignatures = new Set(
    existingPlaylists
      .filter((playlist) => Array.isArray(playlist.trackIds) && playlist.trackIds.length > 0)
      .map((playlist) => playlistTrackSignature(playlist.trackIds))
  );

  const supplementalPlaylists = [];
  for (const playlist of candidates) {
    if (!playlist.trackIds.length) {
      continue;
    }

    const signature = playlistTrackSignature(playlist.trackIds);
    if (seenSignatures.has(signature)) {
      continue;
    }

    seenSignatures.add(signature);
    supplementalPlaylists.push(playlist);
  }

  return supplementalPlaylists.slice(0, Math.max(1, 4 - existingPublicPlaylists.length));
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
    select id, name, followers
    from artists;
  `);
  return sortArtists(rows.map((row) => ({ id: row.id, name: row.name, followers: row.followers })));
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

  if (!normalizedQuery) {
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

  const pattern = `%${normalizedQuery}%`;
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
          lower(t.title) like $1
        or exists (
          select 1
          from track_tags tt
          where tt.track_id = t.id
            and lower(tt.tag) like $1
        )
        or exists (
          select 1
          from track_artists ta
          join artists a on a.id = ta.artist_id
          where ta.track_id = t.id
            and lower(a.name) like $1
        )
        )
      order by t.title
      limit $2
      offset $3;
    `,
      [pattern, trackLimitWithBuffer, safeOffset]
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
        lower(p.title) like $1
        or lower(coalesce(p.subtitle, '')) like $1
        or exists (
          select 1
          from playlist_tracks pt
          join track_tags tt on tt.track_id = pt.track_id
          where pt.playlist_id = p.id
            and lower(tt.tag) like $1
        )
      order by p.title
      limit $2
      offset $3;
    `,
      [pattern, limitPlusOne, safeOffset]
    );
    rawPlaylists = rows;
  }

  if (includeArtists) {
    const { rows } = await pool.query(
      `
      select id, name, followers
      from artists
      where lower(name) like $1
         or exists (
           select 1
           from track_artists ta
           join track_tags tt on tt.track_id = ta.track_id
           where ta.artist_id = artists.id
             and lower(tt.tag) like $1
         )
      order by name
      limit $2
      offset $3;
    `,
      [pattern, limitPlusOne, safeOffset]
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
          lower(r.title) like $1
        or lower(a.name) like $1
        or exists (
          select 1
          from release_tracks rt
          join track_tags tt on tt.track_id = rt.track_id
          where rt.release_id = r.id
            and lower(tt.tag) like $1
        )
        )
      order by coalesce(r.published_at, r.created_at, 0) desc, r.year desc, r.title
      limit $2
      offset $3;
    `,
      [pattern, limitPlusOne, safeOffset]
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

  const artists = rawArtists.slice(0, safeLimit).map((row) => ({
    id: row.id,
    name: row.name,
    followers: row.followers,
  }));

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

  return {
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
