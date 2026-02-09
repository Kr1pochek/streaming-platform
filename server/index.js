import cors from "cors";
import crypto from "node:crypto";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import {
  artistReleases,
  artists as seedArtists,
  initialQueue,
  playlists as seedPlaylists,
  quickActions,
  searchCollections,
  showcases,
  tracks as seedTracks,
  vibeTags,
} from "../src/data/musicData.js";

const USER_PLAYLIST_ID_PREFIX = "upl-";
const DEFAULT_ERROR_MESSAGE = "Не удалось загрузить данные. Попробуй обновить страницу.";
const CUSTOM_PLAYLIST_SUBTITLE = "Пользовательский плейлист";
const customPlaylistCovers = [
  "linear-gradient(135deg, #5f739f 0%, #9ab2ff 50%, #22324d 100%)",
  "linear-gradient(135deg, #f28f6e 0%, #f8d0a5 44%, #7a3b2f 100%)",
  "linear-gradient(135deg, #8f83c9 0%, #c9c1ee 36%, #3a315a 100%)",
  "linear-gradient(135deg, #89ff5e 0%, #3bbf79 45%, #17352d 100%)",
  "linear-gradient(135deg, #f7d255 0%, #f3a2c5 44%, #5f3656 100%)",
];
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const mediaDirectory = path.resolve(currentDirectory, "../public/audio");
const mediaRoutePrefix = "/api/media/";

const trackOrderMap = new Map(seedTracks.map((item, index) => [item.id, index]));
const playlistOrderMap = new Map(seedPlaylists.map((item, index) => [item.id, index]));
const artistOrderMap = new Map(seedArtists.map((item, index) => [item.id, index]));
const artistNameMap = new Map(seedArtists.map((item) => [normalizeArtistName(item.name), item.id]));

const app = express();
const pool = new Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? "music_app",
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD ?? "",
});

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

function normalizeArtistName(value = "") {
  return String(value).toLowerCase().trim();
}

function normalizeTitle(value = "") {
  return String(value ?? "").trim();
}

function splitArtistNames(value = "") {
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function includesText(text = "", query = "") {
  return String(text).toLowerCase().includes(String(query).toLowerCase());
}

function isCustomPlaylistId(playlistId) {
  return String(playlistId).startsWith(USER_PLAYLIST_ID_PREFIX);
}

function isCustomPlaylist(playlist) {
  return Boolean(playlist?.isCustom) || isCustomPlaylistId(playlist?.id);
}

function compareBySeed(orderMap, leftId, rightId) {
  const leftSeed = orderMap.has(leftId) ? orderMap.get(leftId) : Number.MAX_SAFE_INTEGER;
  const rightSeed = orderMap.has(rightId) ? orderMap.get(rightId) : Number.MAX_SAFE_INTEGER;
  if (leftSeed !== rightSeed) {
    return leftSeed - rightSeed;
  }
  return String(leftId).localeCompare(String(rightId), "ru");
}

function coverForPlaylist(seed) {
  const hash = Math.abs(
    String(seed)
      .split("")
      .reduce((acc, char) => acc * 31 + char.charCodeAt(0), 0)
  );
  return customPlaylistCovers[hash % customPlaylistCovers.length];
}

function createAutoArtistId() {
  return `a-auto-${crypto.randomUUID()}`;
}

function resolveMediaFilePath(audioUrl) {
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

function trackHasArtist(track, artistName) {
  const normalizedArtistName = normalizeArtistName(artistName);
  return splitArtistNames(track.artist).some((candidateName) => normalizeArtistName(candidateName) === normalizedArtistName);
}

function findArtistByName(artists, name) {
  const normalizedName = normalizeArtistName(name);
  return artists.find((artist) => normalizeArtistName(artist.name) === normalizedName) ?? null;
}

function getPrimaryArtistForTrack(track, artists) {
  const [primaryArtistName = ""] = splitArtistNames(track.artist);
  return findArtistByName(artists, primaryArtistName);
}

function sortTracks(tracks) {
  return [...tracks].sort((left, right) => compareBySeed(trackOrderMap, left.id, right.id));
}

function sortArtists(artists) {
  return [...artists].sort((left, right) => compareBySeed(artistOrderMap, left.id, right.id));
}

function sortPlaylists(playlists) {
  const basePlaylists = playlists
    .filter((playlist) => !isCustomPlaylist(playlist))
    .sort((left, right) => compareBySeed(playlistOrderMap, left.id, right.id));
  const customPlaylists = playlists
    .filter((playlist) => isCustomPlaylist(playlist))
    .sort((left, right) => (Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0)) || left.id.localeCompare(right.id));
  return [...basePlaylists, ...customPlaylists];
}

function uniqueTrackIds(trackIds = [], trackMap = {}) {
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

function createUserPlaylistId() {
  return `${USER_PLAYLIST_ID_PREFIX}${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

async function withTransaction(work) {
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

async function ensureSchema() {
  await pool.query(`
    create table if not exists artists (
      id text primary key,
      name text not null unique,
      followers text
    );
  `);

  await pool.query(`
    create table if not exists tracks (
      id text primary key,
      title text not null,
      duration_sec int not null,
      explicit boolean not null default false,
      cover text not null,
      audio_url text
    );
  `);

  await pool.query(`
    create table if not exists track_artists (
      track_id text not null references tracks(id) on delete cascade,
      artist_id text not null references artists(id) on delete cascade,
      artist_order smallint not null default 1,
      primary key (track_id, artist_id)
    );
  `);

  await pool.query(`
    create table if not exists track_tags (
      track_id text not null references tracks(id) on delete cascade,
      tag text not null,
      primary key (track_id, tag)
    );
  `);

  await pool.query(`
    create table if not exists playlists (
      id text primary key,
      title text not null,
      subtitle text,
      cover text
    );
  `);

  await pool.query(`
    create table if not exists playlist_tracks (
      playlist_id text not null references playlists(id) on delete cascade,
      track_id text not null references tracks(id) on delete cascade,
      position int not null,
      primary key (playlist_id, position),
      unique (playlist_id, track_id)
    );
  `);

  await pool.query(`
    create table if not exists releases (
      id text primary key,
      artist_id text not null references artists(id) on delete cascade,
      title text not null,
      type text not null check (type in ('album', 'ep', 'single')),
      year int not null,
      cover text not null
    );
  `);

  await pool.query(`
    create table if not exists release_tracks (
      release_id text not null references releases(id) on delete cascade,
      track_id text not null references tracks(id) on delete cascade,
      position int not null,
      primary key (release_id, position),
      unique (release_id, track_id)
    );
  `);

  await pool.query("alter table playlists add column if not exists is_custom boolean not null default false;");
  await pool.query("alter table playlists add column if not exists created_at bigint;");
  await pool.query("alter table tracks add column if not exists audio_url text;");
  await pool.query(
    `update playlists
      set is_custom = true
      where id like $1 and (is_custom is distinct from true);`,
    [`${USER_PLAYLIST_ID_PREFIX}%`]
  );
  await pool.query(
    `update playlists
      set created_at = (extract(epoch from now()) * 1000)::bigint
      where id like $1 and created_at is null;`,
    [`${USER_PLAYLIST_ID_PREFIX}%`]
  );

  await seedCatalogIfEmpty();
  await syncTrackAudioUrls();
  await syncTrackArtists();
  await seedReleasesIfEmpty();
}

async function seedCatalogIfEmpty() {
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

async function syncTrackAudioUrls() {
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

async function syncTrackArtists() {
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

async function validateCatalogAudioFiles() {
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

async function seedReleasesIfEmpty() {
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

async function fetchArtists() {
  const { rows } = await pool.query(`
    select id, name, followers
    from artists;
  `);
  return sortArtists(rows.map((row) => ({ id: row.id, name: row.name, followers: row.followers })));
}

async function fetchTracks() {
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

async function fetchPlaylists() {
  const { rows } = await pool.query(`
    select
      p.id,
      p.title,
      p.subtitle,
      p.cover,
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
    subtitle: row.subtitle,
    cover: row.cover,
    isCustom: Boolean(row.isCustom) || isCustomPlaylistId(row.id),
    createdAt: Number(row.createdAt ?? 0),
    trackIds: Array.isArray(row.trackIds) ? row.trackIds : [],
  }));

  return sortPlaylists(playlists);
}

async function fetchReleases() {
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

async function fetchCatalog() {
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

  return {
    artists,
    tracks,
    trackMap,
    playlists: playlistsWithValidTracks,
    releases,
  };
}

async function getPlaylistById(playlistId) {
  const { rows } = await pool.query(
    `
    select
      p.id,
      p.title,
      p.subtitle,
      p.cover,
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
    subtitle: row.subtitle,
    cover: row.cover,
    isCustom: Boolean(row.isCustom) || isCustomPlaylistId(row.id),
    createdAt: Number(row.createdAt ?? 0),
    trackIds: Array.isArray(row.trackIds) ? row.trackIds : [],
  };
}

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

app.use(cors());
app.use(express.json());
app.use("/api/media", express.static(mediaDirectory));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post(
  "/api/user-playlists",
  asyncHandler(async (req, res) => {
    const title = normalizeTitle(req.body?.title);
    if (!title) {
      throw new HttpError(400, "Название плейлиста не может быть пустым.");
    }

    const id = createUserPlaylistId();
    const createdAt = Date.now();
    const playlist = {
      id,
      title,
      subtitle: CUSTOM_PLAYLIST_SUBTITLE,
      cover: coverForPlaylist(id),
      trackIds: [],
      createdAt,
      isCustom: true,
    };

    await pool.query(
      `
      insert into playlists (id, title, subtitle, cover, is_custom, created_at)
      values ($1, $2, $3, $4, true, $5);
    `,
      [playlist.id, playlist.title, playlist.subtitle, playlist.cover, playlist.createdAt]
    );

    res.status(201).json(playlist);
  })
);

app.patch(
  "/api/user-playlists/:playlistId",
  asyncHandler(async (req, res) => {
    const playlistId = req.params.playlistId;
    if (!isCustomPlaylistId(playlistId)) {
      throw new HttpError(400, "Можно переименовать только пользовательский плейлист.");
    }

    const title = normalizeTitle(req.body?.title);
    if (!title) {
      throw new HttpError(400, "Название плейлиста не может быть пустым.");
    }

    const { rowCount } = await pool.query(
      `
      update playlists
      set title = $2
      where id = $1 and (is_custom = true or id like $3);
    `,
      [playlistId, title, `${USER_PLAYLIST_ID_PREFIX}%`]
    );

    if (!rowCount) {
      throw new HttpError(404, "Плейлист не найден.");
    }

    const playlist = await getPlaylistById(playlistId);
    if (!playlist) {
      throw new HttpError(404, "Плейлист не найден.");
    }

    res.json(playlist);
  })
);

app.delete(
  "/api/user-playlists/:playlistId",
  asyncHandler(async (req, res) => {
    const playlistId = req.params.playlistId;
    if (!isCustomPlaylistId(playlistId)) {
      throw new HttpError(400, "Можно удалить только пользовательский плейлист.");
    }

    const { rowCount } = await pool.query(
      `
      delete from playlists
      where id = $1 and (is_custom = true or id like $2);
    `,
      [playlistId, `${USER_PLAYLIST_ID_PREFIX}%`]
    );

    if (!rowCount) {
      throw new HttpError(404, "Плейлист не найден.");
    }

    res.json({ success: true });
  })
);

app.post(
  "/api/user-playlists/:playlistId/tracks",
  asyncHandler(async (req, res) => {
    const playlistId = req.params.playlistId;
    const trackId = normalizeTitle(req.body?.trackId);

    if (!isCustomPlaylistId(playlistId)) {
      throw new HttpError(400, "Трек можно добавлять только в пользовательский плейлист.");
    }
    if (!trackId) {
      throw new HttpError(400, "Трек не найден.");
    }

    await withTransaction(async (client) => {
      const playlistCheck = await client.query(
        `
        select id
        from playlists
        where id = $1 and (is_custom = true or id like $2)
        limit 1;
      `,
        [playlistId, `${USER_PLAYLIST_ID_PREFIX}%`]
      );
      if (!playlistCheck.rowCount) {
        throw new HttpError(404, "Плейлист не найден.");
      }

      const trackCheck = await client.query("select id from tracks where id = $1 limit 1;", [trackId]);
      if (!trackCheck.rowCount) {
        throw new HttpError(404, "Трек не найден.");
      }

      const exists = await client.query(
        `
        select 1
        from playlist_tracks
        where playlist_id = $1 and track_id = $2
        limit 1;
      `,
        [playlistId, trackId]
      );

      if (!exists.rowCount) {
        const { rows: positionRows } = await client.query(
          `
          select coalesce(max(position), 0) + 1 as position
          from playlist_tracks
          where playlist_id = $1;
        `,
          [playlistId]
        );
        const nextPosition = Number(positionRows[0]?.position ?? 1);
        await client.query(
          `
          insert into playlist_tracks (playlist_id, track_id, position)
          values ($1, $2, $3);
        `,
          [playlistId, trackId, nextPosition]
        );
      }
    });

    const playlist = await getPlaylistById(playlistId);
    if (!playlist) {
      throw new HttpError(404, "Плейлист не найден.");
    }

    res.json(playlist);
  })
);

app.delete(
  "/api/user-playlists/:playlistId/tracks/:trackId",
  asyncHandler(async (req, res) => {
    const playlistId = req.params.playlistId;
    const trackId = req.params.trackId;

    if (!isCustomPlaylistId(playlistId)) {
      throw new HttpError(400, "Трек можно удалять только из пользовательского плейлиста.");
    }

    await withTransaction(async (client) => {
      const playlistCheck = await client.query(
        `
        select id
        from playlists
        where id = $1 and (is_custom = true or id like $2)
        limit 1;
      `,
        [playlistId, `${USER_PLAYLIST_ID_PREFIX}%`]
      );
      if (!playlistCheck.rowCount) {
        throw new HttpError(404, "Плейлист не найден.");
      }

      const trackCheck = await client.query("select id from tracks where id = $1 limit 1;", [trackId]);
      if (!trackCheck.rowCount) {
        throw new HttpError(404, "Трек не найден.");
      }

      await client.query(
        `
        delete from playlist_tracks
        where playlist_id = $1 and track_id = $2;
      `,
        [playlistId, trackId]
      );

      const { rows: orderedRows } = await client.query(
        `
        select track_id
        from playlist_tracks
        where playlist_id = $1
        order by position;
      `,
        [playlistId]
      );

      await client.query("delete from playlist_tracks where playlist_id = $1;", [playlistId]);
      for (let index = 0; index < orderedRows.length; index += 1) {
        await client.query(
          `
          insert into playlist_tracks (playlist_id, track_id, position)
          values ($1, $2, $3);
        `,
          [playlistId, orderedRows[index].track_id, index + 1]
        );
      }
    });

    const playlist = await getPlaylistById(playlistId);
    if (!playlist) {
      throw new HttpError(404, "Плейлист не найден.");
    }

    res.json(playlist);
  })
);

app.get(
  "/api/home-feed",
  asyncHandler(async (_req, res) => {
    const { playlists, trackMap } = await fetchCatalog();
    const freshTrackIds = initialQueue.slice(1, 7).filter((trackId) => Boolean(trackMap[trackId]));
    const enrichedShowcases = showcases.map((item) => {
      const playlist = playlists.find((candidate) => candidate.id === item.playlistId);
      return {
        ...item,
        trackIds: playlist?.trackIds ?? [],
      };
    });

    res.json({
      quickActions,
      showcases: enrichedShowcases,
      vibeTags,
      freshTrackIds,
    });
  })
);

app.get(
  "/api/search-feed",
  asyncHandler(async (_req, res) => {
    const { playlists, tracks } = await fetchCatalog();
    const newTrackIds = tracks.slice(-8).map((track) => track.id);
    const morePlaylists = playlists.map((playlist) => ({
      id: playlist.id,
      title: playlist.title,
      artist: playlist.subtitle,
      cover: playlist.cover,
      trackIds: playlist.trackIds,
    }));

    res.json({
      collections: searchCollections,
      newTrackIds,
      morePlaylists,
    });
  })
);

app.get(
  "/api/search",
  asyncHandler(async (req, res) => {
    const query = normalizeTitle(req.query.query);
    const filter = normalizeTitle(req.query.filter) || "all";
    if (!query) {
      res.json({ tracks: [], playlists: [], artists: [], albums: [] });
      return;
    }

    const { tracks, playlists, artists, releases, trackMap } = await fetchCatalog();

    const foundTracks = tracks.filter((track) => [track.title, track.artist].some((field) => includesText(field, query)));
    const foundPlaylists = playlists.filter((playlist) =>
      [playlist.title, playlist.subtitle].some((field) => includesText(field, query))
    );
    const foundArtists = artists.filter((artist) => includesText(artist.name, query));
    const foundAlbums = releases
      .filter((release) => {
        const artist = artists.find((candidate) => candidate.id === release.artistId);
        return includesText(release.title, query) || includesText(artist?.name ?? "", query);
      })
      .map((release) => {
        const artist = artists.find((candidate) => candidate.id === release.artistId);
        return {
          ...release,
          artistName: artist?.name ?? "Unknown",
          tracks: release.trackIds.map((trackId) => trackMap[trackId]).filter(Boolean),
        };
      })
      .sort((first, second) => second.year - first.year);

    res.json({
      tracks: filter === "all" || filter === "tracks" ? foundTracks : [],
      playlists: filter === "all" || filter === "playlists" ? foundPlaylists : [],
      artists: filter === "all" || filter === "artists" ? foundArtists : [],
      albums: filter === "all" || filter === "albums" ? foundAlbums : [],
    });
  })
);

app.get(
  "/api/library-feed",
  asyncHandler(async (_req, res) => {
    const { playlists, artists } = await fetchCatalog();
    res.json({
      playlists,
      artists,
    });
  })
);

app.get(
  "/api/catalog-map",
  asyncHandler(async (_req, res) => {
    const { tracks, trackMap, playlists, artists } = await fetchCatalog();
    res.json({ tracks, trackMap, playlists, artists });
  })
);

app.get(
  "/api/playlists/:playlistId",
  asyncHandler(async (req, res) => {
    const { playlistId } = req.params;
    const { playlists, trackMap } = await fetchCatalog();
    const playlist = playlists.find((item) => item.id === playlistId);
    if (!playlist) {
      throw new HttpError(404, "Плейлист не найден.");
    }

    const playlistTracks = playlist.trackIds.map((id) => trackMap[id]).filter(Boolean);
    const overlapScore = (candidate) =>
      candidate.trackIds.filter((id) => playlist.trackIds.includes(id)).length;

    const relatedPlaylists = playlists
      .filter((item) => item.id !== playlist.id)
      .sort((first, second) => overlapScore(second) - overlapScore(first))
      .slice(0, 3);

    res.json({
      playlist,
      tracks: playlistTracks,
      relatedPlaylists,
    });
  })
);

app.get(
  "/api/tracks/:trackId",
  asyncHandler(async (req, res) => {
    const { trackId } = req.params;
    const { artists, tracks, trackMap, playlists } = await fetchCatalog();
    const track = trackMap[trackId];
    if (!track) {
      throw new HttpError(404, "Трек не найден.");
    }

    const artist = getPrimaryArtistForTrack(track, artists);
    const inPlaylists = playlists.filter((playlist) => playlist.trackIds.includes(trackId));
    const playlistToggles = playlists
      .filter((playlist) => isCustomPlaylist(playlist))
      .map((playlist) => ({
        ...playlist,
        hasTrack: playlist.trackIds.includes(trackId),
      }));
    const moreByArtist = tracks.filter((item) => item.artist === track.artist && item.id !== trackId).slice(0, 6);
    const trackScore = (candidate) =>
      candidate.artist === track.artist ? 4 : candidate.tags.filter((tag) => track.tags.includes(tag)).length;

    const relatedTracks = tracks
      .filter((item) => item.id !== track.id)
      .sort((first, second) => trackScore(second) - trackScore(first))
      .slice(0, 8);

    res.json({
      track,
      artist,
      inPlaylists,
      playlistToggles,
      moreByArtist,
      relatedTracks,
    });
  })
);

app.get(
  "/api/artists/:artistId",
  asyncHandler(async (req, res) => {
    const { artistId } = req.params;
    const { artists, tracks, trackMap, playlists, releases } = await fetchCatalog();
    const artist = artists.find((item) => item.id === artistId);
    if (!artist) {
      throw new HttpError(404, "Исполнитель не найден.");
    }

    const artistTracks = tracks.filter((track) => trackHasArtist(track, artist.name));
    const artistTrackIds = new Set(artistTracks.map((track) => track.id));
    const topTracks = artistTracks.slice(0, 8);

    const artistReleasesEnriched = releases
      .filter((release) => release.artistId === artist.id)
      .map((release) => ({
        ...release,
        artistName: artist.name,
        tracks: release.trackIds.map((trackId) => trackMap[trackId]).filter(Boolean),
      }))
      .sort((first, second) => second.year - first.year);

    const albums = artistReleasesEnriched.filter((release) => release.type === "album");
    const eps = artistReleasesEnriched.filter((release) => release.type === "ep");
    const singles = artistReleasesEnriched.filter((release) => release.type === "single");
    const latestRelease = artistReleasesEnriched[0] ?? null;
    const popularAlbums = albums.slice(0, 10);

    const featuredPlaylists = playlists
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

    res.json({
      artist,
      topTracks,
      latestRelease,
      popularAlbums,
      albums,
      eps,
      singles,
      featuredPlaylists,
      relatedArtists,
    });
  })
);

app.get(
  "/api/releases/:releaseId",
  asyncHandler(async (req, res) => {
    const { releaseId } = req.params;
    const { artists, trackMap, playlists, releases } = await fetchCatalog();
    const release = releases.find((item) => item.id === releaseId);
    if (!release) {
      throw new HttpError(404, "Релиз не найден.");
    }

    const artist = artists.find((item) => item.id === release.artistId) ?? null;
    const releaseTracks = release.trackIds.map((trackId) => trackMap[trackId]).filter(Boolean);
    const totalDurationSec = releaseTracks.reduce((sum, track) => sum + (track.durationSec ?? 0), 0);

    const moreReleasesByArtist = releases
      .filter((item) => item.artistId === release.artistId && item.id !== release.id)
      .sort((first, second) => second.year - first.year)
      .map((item) => ({
        ...item,
        artistName: artist?.name ?? "",
        tracks: item.trackIds.map((trackId) => trackMap[trackId]).filter(Boolean),
      }))
      .slice(0, 8);

    const relatedPlaylists = playlists
      .filter((playlist) => playlist.trackIds.some((trackId) => release.trackIds.includes(trackId)))
      .slice(0, 4);

    res.json({
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
    });
  })
);

app.get(
  "/api/smart-recommendations",
  asyncHandler(async (_req, res) => {
    const { tracks, trackMap, playlists, artists } = await fetchCatalog();
    const uniqueTrackIds = [...new Set([...initialQueue, ...tracks.map((track) => track.id)])];
    const recommendedTracks = uniqueTrackIds.map((trackId) => trackMap[trackId]).filter(Boolean).slice(0, 6);
    const recommendedPlaylists = playlists.slice(0, 4);
    const recommendedArtists = artists.slice(0, 6);

    res.json({
      tracks: recommendedTracks,
      playlists: recommendedPlaylists,
      artists: recommendedArtists,
    });
  })
);

app.use((error, _req, res, next) => {
  void next;
  const status = Number(error?.status) || 500;
  const message = status >= 500 ? DEFAULT_ERROR_MESSAGE : error?.message || DEFAULT_ERROR_MESSAGE;
  if (status >= 500) {
    console.error(error);
  }
  res.status(status).json({ message });
});

async function startServer() {
  await ensureSchema();
  const validatedTracksCount = await validateCatalogAudioFiles();
  console.log(`Audio files validated for ${validatedTracksCount} tracks.`);

  const port = Number(process.env.API_PORT ?? 4000);
  const host = process.env.API_HOST ?? "127.0.0.1";
  const server = app.listen(port, host, () => {
    console.log(`API server is running on http://${host}:${port}`);
  });

  const shutdown = async () => {
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

startServer().catch((error) => {
  console.error("Failed to start API server:", error);
  process.exit(1);
});
