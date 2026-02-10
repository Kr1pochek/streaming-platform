import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import {
  artistReleases,
  artists as seedArtists,
  playlists as seedPlaylists,
  tracks as seedTracks,
} from "../../src/data/musicData.js";
export const USER_PLAYLIST_ID_PREFIX = "upl-";
export const DEFAULT_ERROR_MESSAGE = "РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ РґР°РЅРЅС‹Рµ. РџРѕРїСЂРѕР±СѓР№ РѕР±РЅРѕРІРёС‚СЊ СЃС‚СЂР°РЅРёС†Сѓ.";
export const CUSTOM_PLAYLIST_SUBTITLE = "Custom playlist";
const LEGACY_CUSTOM_PLAYLIST_SUBTITLES = new Set([
  "Пользовательский плейлист",
  "РџРѕР»СЊР·РѕРІР°С‚РµР»СЊСЃРєРёР№ РїР»РµР№Р»РёСЃС‚",
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

const trackOrderMap = new Map(seedTracks.map((item, index) => [item.id, index]));
const playlistOrderMap = new Map(seedPlaylists.map((item, index) => [item.id, index]));
const artistOrderMap = new Map(seedArtists.map((item, index) => [item.id, index]));
const artistNameMap = new Map(seedArtists.map((item) => [normalizeArtistName(item.name), item.id]));
const CATALOG_CACHE_TTL_MS = Number(process.env.CATALOG_CACHE_TTL_MS ?? 4000);
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

export function normalizePlaylistSubtitle(value = "") {
  const subtitle = normalizeTitle(value);
  if (LEGACY_CUSTOM_PLAYLIST_SUBTITLES.has(subtitle)) {
    return CUSTOM_PLAYLIST_SUBTITLE;
  }
  return subtitle;
}

export function splitArtistNames(value = "") {
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function includesText(text = "", query = "") {
  return String(text).toLowerCase().includes(String(query).toLowerCase());
}

export function isCustomPlaylistId(playlistId) {
  return String(playlistId).startsWith(USER_PLAYLIST_ID_PREFIX);
}

export function isCustomPlaylist(playlist) {
  return Boolean(playlist?.isCustom) || isCustomPlaylistId(playlist?.id);
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

export function sortTracks(tracks) {
  return [...tracks].sort((left, right) => compareBySeed(trackOrderMap, left.id, right.id));
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
  const { rows } = await pool.query("select count(*)::int as count from tracks;");
  if (Number(rows[0]?.count ?? 0) > 0) {
    return;
  }

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
        `insert into tracks (id, title, duration_sec, explicit, cover, audio_url)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (id) do update
           set title = excluded.title,
               duration_sec = excluded.duration_sec,
               explicit = excluded.explicit,
               cover = excluded.cover,
               audio_url = excluded.audio_url;`,
        [track.id, track.title, track.durationSec, track.explicit, track.cover, track.audioUrl ?? null]
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

      for (const tag of track.tags ?? []) {
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

export async function validateCatalogAudioFiles() {
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
    return rows.length;
  }

  const details = [];
  if (missingAudioUrl.length) {
    details.push(`missing audioUrl: ${missingAudioUrl.join(", ")}`);
  }
  if (missingFiles.length) {
    details.push(`missing files: ${missingFiles.join(", ")}`);
  }
  if (invalidLocalUrls.length) {
    details.push(`invalid local URLs: ${invalidLocalUrls.join(", ")}`);
  }
  throw new Error(`Audio catalog validation failed (${rows.length} tracks): ${details.join("; ")}`);
}

export async function seedReleasesIfEmpty() {
  const { rows } = await pool.query("select count(*)::int as count from releases;");
  if (Number(rows[0]?.count ?? 0) > 0) {
    return;
  }

  await withTransaction(async (client) => {
    for (const release of artistReleases) {
      await client.query(
        `insert into releases (id, artist_id, title, type, year, cover)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (id) do update
           set artist_id = excluded.artist_id,
               title = excluded.title,
               type = excluded.type,
               year = excluded.year,
               cover = excluded.cover;`,
        [release.id, release.artistId, release.title, release.type, release.year, release.cover]
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
    from tracks t;
  `);

  const tracks = rows.map((row) => ({
    id: row.id,
    title: row.title,
    artist: row.artist,
    durationSec: Number(row.durationSec),
    explicit: Boolean(row.explicit),
    cover: row.cover,
    audioUrl: row.audioUrl,
    tags: Array.isArray(row.tags) ? row.tags : [],
  }));

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
    createdAt: Number(row.createdAt ?? 0),
    trackIds: Array.isArray(row.trackIds) ? row.trackIds : [],
  }));

  return sortPlaylists(playlists);
}

export async function fetchReleases() {
  const { rows } = await pool.query(`
    select
      r.id,
      r.artist_id as "artistId",
      r.title,
      r.type,
      r.year,
      r.cover,
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

  return rows.map((row) => ({
    id: row.id,
    artistId: row.artistId,
    title: row.title,
    type: row.type,
    year: Number(row.year),
    cover: row.cover,
    trackIds: Array.isArray(row.trackIds) ? row.trackIds : [],
  }));
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
  const includeTracks = normalizedFilter === "all" || normalizedFilter === "tracks";
  const includePlaylists = normalizedFilter === "all" || normalizedFilter === "playlists";
  const includeArtists = normalizedFilter === "all" || normalizedFilter === "artists";
  const includeAlbums = normalizedFilter === "all" || normalizedFilter === "albums";

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
        lower(t.title) like $1
        or exists (
          select 1
          from track_artists ta
          join artists a on a.id = ta.artist_id
          where ta.track_id = t.id
            and lower(a.name) like $1
        )
      order by t.title
      limit $2
      offset $3;
    `,
      [pattern, limitPlusOne, safeOffset]
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
        lower(r.title) like $1
        or lower(a.name) like $1
      order by r.year desc, r.title
      limit $2
      offset $3;
    `,
      [pattern, limitPlusOne, safeOffset]
    );
    rawAlbums = rows;
  }

  const tracksHasMore = rawTracks.length > safeLimit;
  const playlistsHasMore = rawPlaylists.length > safeLimit;
  const artistsHasMore = rawArtists.length > safeLimit;
  const albumsHasMore = rawAlbums.length > safeLimit;
  const hasMore = tracksHasMore || playlistsHasMore || artistsHasMore || albumsHasMore;

  const tracks = rawTracks.slice(0, safeLimit).map((row) => ({
    id: row.id,
    title: row.title,
    artist: row.artist,
    durationSec: Number(row.durationSec ?? 0),
    explicit: Boolean(row.explicit),
    cover: row.cover,
    audioUrl: row.audioUrl,
    tags: Array.isArray(row.tags) ? row.tags : [],
  }));

  const playlists = rawPlaylists.slice(0, safeLimit).map((row) => ({
    id: row.id,
    title: row.title,
    subtitle: normalizePlaylistSubtitle(row.subtitle),
    cover: row.cover,
    userId: row.userId ?? null,
    isCustom: Boolean(row.isCustom) || isCustomPlaylistId(row.id),
    createdAt: Number(row.createdAt ?? 0),
    trackIds: Array.isArray(row.trackIds) ? row.trackIds : [],
  }));

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
  }));

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

  const catalog = {
    artists,
    tracks,
    trackMap,
    playlists: playlistsWithValidTracks,
    releases,
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
  await seedCatalogIfEmpty();
  await syncTrackAudioUrls();
  await syncTrackArtists();
  await seedReleasesIfEmpty();
  invalidateCatalogCache();
}

export async function closePool() {
  await pool.end();
}
