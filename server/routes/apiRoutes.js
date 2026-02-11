import fs from "node:fs";
import path from "node:path";
import express from "express";
import multer from "multer";
import {
  initialQueue,
  quickActions,
  searchCollections,
  showcases,
  vibeTags,
} from "../../shared/musicData.js";
import { optionalAuth, requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { createRateLimiter, resolveRequestIp } from "../middleware/rateLimit.js";
import {
  createSession,
  createUserAccount,
  pruneExpiredSessions,
  revokeSession,
  verifyUserCredentials,
} from "../services/authService.js";
import {
  CUSTOM_PLAYLIST_SUBTITLE,
  HttpError,
  USER_PLAYLIST_ID_PREFIX,
  coverForPlaylist,
  createUserPlaylistId,
  fetchCatalog,
  getPlaylistById,
  getPrimaryArtistForTrack,
  hlsManifestUrlForTrack,
  hasHlsManifestForTrack,
  invalidateCatalogCache,
  isCustomPlaylist,
  isCustomPlaylistId,
  normalizeTitle,
  pool,
  resolveMediaFilePath,
  streamRoutePrefix,
  searchCatalogInDatabase,
  trackHasArtist,
  withTransaction,
} from "../services/catalogService.js";
import {
  createSignedStreamUrl,
  getPlaybackUrlTtlMs,
  validateSignedPlaybackRequest,
} from "../services/playbackService.js";
import { getSmartRecommendations } from "../services/recommendationService.js";
import { fetchUserState, updateUserState } from "../services/userStateService.js";
import { ingestUploadedTrack } from "../services/trackUploadService.js";

const authRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 20),
  maxEntries: Number(process.env.AUTH_RATE_LIMIT_MAX_ENTRIES ?? 5_000),
  cleanupIntervalMs: Number(process.env.AUTH_RATE_LIMIT_CLEANUP_MS ?? 30_000),
  keyResolver: (req) => `auth:${resolveRequestIp(req)}`,
});
const MAX_PLAYLIST_TITLE_LENGTH = 80;
const MAX_PLAYLIST_DESCRIPTION_LENGTH = 280;
const MAX_PLAYLIST_COVER_LENGTH = 2_000_000;
const DEFAULT_STREAM_CHUNK_SIZE = 1024 * 1024;
const MAX_STREAM_CHUNK_SIZE = 8 * 1024 * 1024;
const mimeTypeByExtension = new Map([
  [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"],
  [".ogg", "audio/ogg"],
  [".m4a", "audio/mp4"],
  [".flac", "audio/flac"],
]);
const TRACK_UPLOAD_MAX_BYTES = Number(process.env.TRACK_UPLOAD_MAX_BYTES ?? 80 * 1024 * 1024);
const trackUploadTempDirectory = path.resolve(
  process.cwd(),
  String(process.env.TRACK_UPLOAD_TEMP_DIR ?? "tmp/uploads")
);
fs.mkdirSync(trackUploadTempDirectory, { recursive: true });
const trackUploadMiddleware = multer({
  dest: trackUploadTempDirectory,
  limits: {
    fileSize: TRACK_UPLOAD_MAX_BYTES,
  },
});

function parseLimit(value, fallback = 12) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, 1), 50);
}

function parseOffset(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(parsed, 0);
}

function requestUserId(req) {
  return req.auth?.userId ?? null;
}

function requestUser(req) {
  return req.auth?.user ?? null;
}

function hasOwnField(payload, field) {
  return Object.prototype.hasOwnProperty.call(payload ?? {}, field);
}

function parseChunkSize() {
  const raw = Number.parseInt(String(process.env.STREAM_CHUNK_SIZE ?? DEFAULT_STREAM_CHUNK_SIZE), 10);
  if (!Number.isFinite(raw)) {
    return DEFAULT_STREAM_CHUNK_SIZE;
  }
  return Math.min(Math.max(raw, 64 * 1024), MAX_STREAM_CHUNK_SIZE);
}

function contentTypeForFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return mimeTypeByExtension.get(extension) ?? "application/octet-stream";
}

function streamFileRange(req, res, filePath, fileSize, readStreamFactory = fs.createReadStream) {
  const rangeHeader = String(req.headers.range ?? "").trim();
  const contentType = contentTypeForFile(filePath);
  const chunkSize = parseChunkSize();

  if (!rangeHeader || !rangeHeader.startsWith("bytes=")) {
    const fallbackEnd = Math.min(fileSize - 1, chunkSize - 1);
    const responseLength = fallbackEnd + 1;
    res.status(206);
    res.set({
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Content-Length": responseLength,
      "Content-Range": `bytes 0-${fallbackEnd}/${fileSize}`,
      "Cache-Control": "no-store",
    });
    readStreamFactory(filePath, { start: 0, end: fallbackEnd }).pipe(res);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader);
  if (!match) {
    res.status(416).set("Content-Range", `bytes */${fileSize}`).end();
    return;
  }

  const [, startText, endText] = match;
  let start = 0;
  let end = fileSize - 1;

  if (!startText && !endText) {
    res.status(416).set("Content-Range", `bytes */${fileSize}`).end();
    return;
  }

  if (!startText && endText) {
    const suffixLength = Number.parseInt(endText, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      res.status(416).set("Content-Range", `bytes */${fileSize}`).end();
      return;
    }
    start = Math.max(fileSize - suffixLength, 0);
  } else {
    start = Number.parseInt(startText, 10);
    if (!Number.isFinite(start) || start < 0) {
      res.status(416).set("Content-Range", `bytes */${fileSize}`).end();
      return;
    }
  }

  if (endText) {
    const parsedEnd = Number.parseInt(endText, 10);
    if (!Number.isFinite(parsedEnd) || parsedEnd < 0) {
      res.status(416).set("Content-Range", `bytes */${fileSize}`).end();
      return;
    }
    end = Math.min(parsedEnd, fileSize - 1);
  } else {
    end = Math.min(start + chunkSize - 1, fileSize - 1);
  }

  if (start >= fileSize || end < start) {
    res.status(416).set("Content-Range", `bytes */${fileSize}`).end();
    return;
  }

  const responseLength = end - start + 1;
  res.status(206);
  res.set({
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Content-Length": responseLength,
    "Content-Range": `bytes ${start}-${end}/${fileSize}`,
    "Cache-Control": "no-store",
  });
  readStreamFactory(filePath, { start, end }).pipe(res);
}

function parsePlaylistTitle(value) {
  const title = normalizeTitle(value);
  if (!title) {
    throw new HttpError(400, "Playlist title is required.");
  }
  if (title.length > MAX_PLAYLIST_TITLE_LENGTH) {
    throw new HttpError(400, `Playlist title must be ${MAX_PLAYLIST_TITLE_LENGTH} characters or fewer.`);
  }
  return title;
}

function parsePlaylistDescription(value) {
  const description = normalizeTitle(value);
  if (description.length > MAX_PLAYLIST_DESCRIPTION_LENGTH) {
    throw new HttpError(400, `Playlist description must be ${MAX_PLAYLIST_DESCRIPTION_LENGTH} characters or fewer.`);
  }
  return description;
}

function parsePlaylistCover(value) {
  const cover = normalizeTitle(value);
  if (cover.length > MAX_PLAYLIST_COVER_LENGTH) {
    throw new HttpError(400, "Playlist cover payload is too large.");
  }
  return cover;
}

function canReadPlaylist(playlist, userId) {
  if (!playlist) {
    return false;
  }
  if (!isCustomPlaylist(playlist)) {
    return true;
  }
  return Boolean(userId && playlist.userId === userId);
}

function filterPlaylistsForUser(playlists = [], userId = null) {
  return playlists.filter((playlist) => canReadPlaylist(playlist, userId));
}

async function ensureOwnedCustomPlaylist(client, playlistId, userId) {
  const { rowCount } = await client.query(
    `
    select id
    from playlists
    where id = $1
      and (is_custom = true or id like $2)
      and user_id = $3
    limit 1;
  `,
    [playlistId, `${USER_PLAYLIST_ID_PREFIX}%`, userId]
  );

  if (!rowCount) {
    throw new HttpError(404, "Playlist not found.");
  }
}

async function ensureTrackExists(client, trackId) {
  const { rowCount } = await client.query("select id from tracks where id = $1 limit 1;", [trackId]);
  if (!rowCount) {
    throw new HttpError(404, "Track not found.");
  }
}

export function createApiRouter({
  catalogFetcher = fetchCatalog,
  mediaPathResolver = resolveMediaFilePath,
  statFile = fs.statSync,
  readStreamFactory = fs.createReadStream,
  nowProvider = () => Date.now(),
} = {}) {
  const router = express.Router();
  router.use(optionalAuth);

  router.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  router.post(
    "/auth/register",
    authRateLimiter,
    asyncHandler(async (req, res) => {
      const username = normalizeTitle(req.body?.username);
      const password = String(req.body?.password ?? "");
      const displayName = normalizeTitle(req.body?.displayName);

      if (!username || !password) {
        throw new HttpError(400, "Username and password are required.");
      }

      const user = await createUserAccount({ username, password, displayName });
      const session = await createSession(user.id);
      await pruneExpiredSessions();
      const playerState = await fetchUserState(user.id);

      res.status(201).json({
        user,
        token: session.token,
        expiresAt: session.expiresAt,
        playerState,
      });
    })
  );

  router.post(
    "/auth/login",
    authRateLimiter,
    asyncHandler(async (req, res) => {
      const username = normalizeTitle(req.body?.username);
      const password = String(req.body?.password ?? "");
      if (!username || !password) {
        throw new HttpError(400, "Username and password are required.");
      }

      const user = await verifyUserCredentials({ username, password });
      if (!user) {
        throw new HttpError(401, "Invalid username or password.");
      }

      const session = await createSession(user.id);
      await pruneExpiredSessions();
      const playerState = await fetchUserState(user.id);

      res.json({
        user,
        token: session.token,
        expiresAt: session.expiresAt,
        playerState,
      });
    })
  );

  router.post(
    "/auth/logout",
    requireAuth,
    asyncHandler(async (req, res) => {
      await revokeSession(req.auth?.token);
      res.json({ success: true });
    })
  );

  router.get(
    "/auth/me",
    requireAuth,
    asyncHandler(async (req, res) => {
      const user = requestUser(req);
      const playerState = await fetchUserState(req.auth.userId);
      res.json({ user, playerState });
    })
  );

  router.get(
    "/me/player-state",
    requireAuth,
    asyncHandler(async (req, res) => {
      const state = await fetchUserState(req.auth.userId);
      res.json(state);
    })
  );

  router.put(
    "/me/player-state",
    requireAuth,
    asyncHandler(async (req, res) => {
      const nextState = {
        likedTrackIds: Array.isArray(req.body?.likedTrackIds) ? req.body.likedTrackIds : [],
        followedArtistIds: Array.isArray(req.body?.followedArtistIds) ? req.body.followedArtistIds : [],
        historyTrackIds: Array.isArray(req.body?.historyTrackIds) ? req.body.historyTrackIds : [],
      };
      const saved = await updateUserState(req.auth.userId, nextState);
      res.json(saved);
    })
  );

  router.post(
    "/tracks/upload",
    requireAuth,
    trackUploadMiddleware.single("audio"),
    asyncHandler(async (req, res) => {
      const uploadedFile = req.file;
      if (!uploadedFile) {
        throw new HttpError(400, "Audio file is required.");
      }

      try {
        const uploadResult = await ingestUploadedTrack({
          uploadFilePath: uploadedFile.path,
          originalFileName: uploadedFile.originalname,
          mimetype: uploadedFile.mimetype,
          trackId: req.body?.trackId,
          title: req.body?.title,
          artist: req.body?.artist,
          durationSec: req.body?.durationSec,
          explicit: req.body?.explicit,
          cover: req.body?.cover,
          tags: req.body?.tags,
        });

        const { trackMap } = await catalogFetcher();
        const track = trackMap[uploadResult.id] ?? null;
        if (!track) {
          throw new HttpError(500, "Track was uploaded but is not available in catalog.");
        }

        res.status(201).json({
          track,
          hlsGenerated: uploadResult.hlsGenerated,
        });
      } finally {
        fs.rmSync(uploadedFile.path, { force: true });
      }
    })
  );

  router.post(
    "/user-playlists",
    requireAuth,
    asyncHandler(async (req, res) => {
      const title = parsePlaylistTitle(req.body?.title);
      const description = parsePlaylistDescription(req.body?.description);
      const coverInput = parsePlaylistCover(req.body?.cover);

      const id = createUserPlaylistId();
      const createdAt = Date.now();
      const userId = req.auth.userId;
      const playlist = {
        id,
        title,
        subtitle: description || CUSTOM_PLAYLIST_SUBTITLE,
        cover: coverInput || coverForPlaylist(id),
        trackIds: [],
        createdAt,
        userId,
        isCustom: true,
      };

      await pool.query(
        `
        insert into playlists (id, title, subtitle, cover, is_custom, created_at, user_id)
        values ($1, $2, $3, $4, true, $5, $6);
      `,
        [playlist.id, playlist.title, playlist.subtitle, playlist.cover, playlist.createdAt, userId]
      );
      invalidateCatalogCache();

      res.status(201).json(playlist);
    })
  );

  router.patch(
    "/user-playlists/:playlistId",
    requireAuth,
    asyncHandler(async (req, res) => {
      const playlistId = req.params.playlistId;
      if (!isCustomPlaylistId(playlistId)) {
        throw new HttpError(400, "Only custom playlists can be edited.");
      }

      const payload = req.body ?? {};
      const hasTitle = hasOwnField(payload, "title");
      const hasDescription = hasOwnField(payload, "description");
      const hasCover = hasOwnField(payload, "cover");

      if (!hasTitle && !hasDescription && !hasCover) {
        throw new HttpError(400, "No fields to update.");
      }

      const nextTitle = hasTitle ? parsePlaylistTitle(payload.title) : null;
      const parsedDescription = hasDescription ? parsePlaylistDescription(payload.description) : "";
      const nextSubtitle = hasDescription ? parsedDescription || CUSTOM_PLAYLIST_SUBTITLE : null;
      const parsedCover = hasCover ? parsePlaylistCover(payload.cover) : "";
      const nextCover = hasCover ? parsedCover || coverForPlaylist(playlistId) : null;

      const { rowCount } = await pool.query(
        `
        update playlists
        set
          title = case when $2::boolean then $3 else title end,
          subtitle = case when $4::boolean then $5 else subtitle end,
          cover = case when $6::boolean then $7 else cover end
        where id = $1
          and (is_custom = true or id like $8)
          and user_id = $9;
      `,
        [
          playlistId,
          hasTitle,
          nextTitle,
          hasDescription,
          nextSubtitle,
          hasCover,
          nextCover,
          `${USER_PLAYLIST_ID_PREFIX}%`,
          req.auth.userId,
        ]
      );

      if (!rowCount) {
        throw new HttpError(404, "Playlist not found.");
      }

      invalidateCatalogCache();
      const playlist = await getPlaylistById(playlistId);
      if (!canReadPlaylist(playlist, req.auth.userId)) {
        throw new HttpError(404, "Playlist not found.");
      }

      res.json(playlist);
    })
  );

  router.delete(
    "/user-playlists/:playlistId",
    requireAuth,
    asyncHandler(async (req, res) => {
      const playlistId = req.params.playlistId;
      if (!isCustomPlaylistId(playlistId)) {
        throw new HttpError(400, "Only custom playlists can be deleted.");
      }

      const { rowCount } = await pool.query(
        `
        delete from playlists
        where id = $1
          and (is_custom = true or id like $2)
          and user_id = $3;
      `,
        [playlistId, `${USER_PLAYLIST_ID_PREFIX}%`, req.auth.userId]
      );

      if (!rowCount) {
        throw new HttpError(404, "Playlist not found.");
      }

      invalidateCatalogCache();
      res.json({ success: true });
    })
  );

  router.post(
    "/user-playlists/:playlistId/tracks",
    requireAuth,
    asyncHandler(async (req, res) => {
      const playlistId = req.params.playlistId;
      const trackId = normalizeTitle(req.body?.trackId);

      if (!isCustomPlaylistId(playlistId)) {
        throw new HttpError(400, "Tracks can only be added to custom playlists.");
      }
      if (!trackId) {
        throw new HttpError(400, "Track not found.");
      }

      await withTransaction(async (client) => {
        await ensureOwnedCustomPlaylist(client, playlistId, req.auth.userId);
        await ensureTrackExists(client, trackId);

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

      invalidateCatalogCache();
      const playlist = await getPlaylistById(playlistId);
      if (!canReadPlaylist(playlist, req.auth.userId)) {
        throw new HttpError(404, "Playlist not found.");
      }

      res.json(playlist);
    })
  );

  router.delete(
    "/user-playlists/:playlistId/tracks/:trackId",
    requireAuth,
    asyncHandler(async (req, res) => {
      const playlistId = req.params.playlistId;
      const trackId = req.params.trackId;

      if (!isCustomPlaylistId(playlistId)) {
        throw new HttpError(400, "Tracks can only be removed from custom playlists.");
      }

      await withTransaction(async (client) => {
        await ensureOwnedCustomPlaylist(client, playlistId, req.auth.userId);
        await ensureTrackExists(client, trackId);

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

      invalidateCatalogCache();
      const playlist = await getPlaylistById(playlistId);
      if (!canReadPlaylist(playlist, req.auth.userId)) {
        throw new HttpError(404, "Playlist not found.");
      }

      res.json(playlist);
    })
  );

  router.get(
    "/home-feed",
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

  router.get(
    "/search-feed",
    asyncHandler(async (req, res) => {
      const { playlists, tracks } = await fetchCatalog();
      const userId = requestUserId(req);
      const visiblePlaylists = filterPlaylistsForUser(playlists, userId);
      const newTrackIds = tracks.slice(-8).map((track) => track.id);
      const morePlaylists = visiblePlaylists.map((playlist) => ({
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

  router.get(
    "/search",
    asyncHandler(async (req, res) => {
      const query = normalizeTitle(req.query.query);
      const filter = normalizeTitle(req.query.filter) || "all";
      const limit = parseLimit(req.query.limit, 12);
      const offset = parseOffset(req.query.offset, 0);

      if (!query) {
        res.json({
          tracks: [],
          playlists: [],
          artists: [],
          albums: [],
          pagination: {
            limit,
            offset,
            hasMore: false,
            nextOffset: null,
          },
        });
        return;
      }

      const result = await searchCatalogInDatabase({
        query,
        filter,
        limit,
        offset,
      });

      const userId = requestUserId(req);
      const visiblePlaylists = filterPlaylistsForUser(result.playlists, userId);
      const hasPlaylistOverflow = visiblePlaylists.length < result.playlists.length;
      const adjustedHasMore = Boolean(result.pagination.hasMore || hasPlaylistOverflow);

      res.json({
        ...result,
        playlists: visiblePlaylists,
        pagination: {
          ...result.pagination,
          hasMore: adjustedHasMore,
          nextOffset: adjustedHasMore ? offset + limit : null,
        },
      });
    })
  );

  router.get(
    "/library-feed",
    asyncHandler(async (req, res) => {
      const { playlists, artists } = await fetchCatalog();
      const userId = requestUserId(req);
      const visiblePlaylists = filterPlaylistsForUser(playlists, userId);
      const myPlaylists = userId
        ? visiblePlaylists.filter((playlist) => isCustomPlaylist(playlist) && playlist.userId === userId)
        : [];
      let followedArtists = [];

      if (userId) {
        const userState = await fetchUserState(userId);
        const followedArtistIdSet = new Set(userState.followedArtistIds ?? []);
        followedArtists = artists.filter((artist) => followedArtistIdSet.has(artist.id));
      }

      res.json({
        playlists: myPlaylists,
        artists: followedArtists,
      });
    })
  );

  router.get(
    "/catalog-map",
    asyncHandler(async (req, res) => {
      const { tracks, trackMap, playlists, artists } = await fetchCatalog();
      const visiblePlaylists = filterPlaylistsForUser(playlists, requestUserId(req));
      res.json({ tracks, trackMap, playlists: visiblePlaylists, artists });
    })
  );

  router.get(
    "/playlists/:playlistId",
    asyncHandler(async (req, res) => {
      const { playlistId } = req.params;
      const { playlists, trackMap } = await fetchCatalog();
      const userId = requestUserId(req);

      const playlist = playlists.find((item) => item.id === playlistId);
      if (!canReadPlaylist(playlist, userId)) {
        throw new HttpError(404, "Playlist not found.");
      }

      const visiblePlaylists = filterPlaylistsForUser(playlists, userId);
      const playlistTracks = playlist.trackIds.map((id) => trackMap[id]).filter(Boolean);
      const overlapScore = (candidate) =>
        candidate.trackIds.filter((id) => playlist.trackIds.includes(id)).length;

      const relatedPlaylists = visiblePlaylists
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

  router.get(
    "/playback/:trackId",
    asyncHandler(async (req, res) => {
      const trackId = normalizeTitle(req.params.trackId);
      if (!trackId) {
        throw new HttpError(404, "Track not found.");
      }

      const { trackMap } = await catalogFetcher();
      const track = trackMap[trackId];
      if (!track) {
        throw new HttpError(404, "Track not found.");
      }

      const sourceAudioUrl = normalizeTitle(track.rawAudioUrl ?? track.audioUrl);
      if (!sourceAudioUrl) {
        throw new HttpError(404, "Track source is not available.");
      }

      const nowMs = nowProvider();
      const isLocalSource = Boolean(mediaPathResolver(sourceAudioUrl));
      const streamDescriptor = isLocalSource
        ? createSignedStreamUrl(trackId, {
            basePath: streamRoutePrefix.slice(0, -1),
            nowMs,
            ttlMs: getPlaybackUrlTtlMs(),
          })
        : { url: sourceAudioUrl, expiresAt: null, signed: false };

      const hlsUrl = hasHlsManifestForTrack(trackId) ? hlsManifestUrlForTrack(trackId) : null;
      res.json({
        trackId,
        streamUrl: streamDescriptor.url,
        expiresAt: streamDescriptor.expiresAt,
        signed: streamDescriptor.signed,
        hlsUrl,
      });
    })
  );

  router.get(
    "/stream/:trackId",
    asyncHandler(async (req, res) => {
      const trackId = normalizeTitle(req.params.trackId);
      if (!trackId) {
        throw new HttpError(404, "Track not found.");
      }

      const playbackValidation = validateSignedPlaybackRequest({
        trackId,
        signature: req.query.sig,
        expiresAt: req.query.exp,
        nowMs: nowProvider(),
      });
      if (!playbackValidation.ok) {
        throw new HttpError(playbackValidation.status ?? 403, playbackValidation.message ?? "Forbidden.");
      }

      const { trackMap } = await catalogFetcher();
      const track = trackMap[trackId];
      if (!track) {
        throw new HttpError(404, "Track not found.");
      }

      const sourceAudioUrl = normalizeTitle(track.rawAudioUrl ?? track.audioUrl);
      const localMediaPath = mediaPathResolver(sourceAudioUrl);
      if (!localMediaPath) {
        throw new HttpError(400, "Track source is not available for local streaming.");
      }

      let fileStats;
      try {
        fileStats = statFile(localMediaPath);
      } catch {
        throw new HttpError(404, "Audio file is missing.");
      }

      if (!fileStats.isFile()) {
        throw new HttpError(404, "Audio file is missing.");
      }

      streamFileRange(req, res, localMediaPath, fileStats.size, readStreamFactory);
    })
  );

  router.get(
    "/tracks/:trackId",
    asyncHandler(async (req, res) => {
      const { trackId } = req.params;
      const { artists, tracks, trackMap, playlists } = await fetchCatalog();
      const track = trackMap[trackId];
      if (!track) {
        throw new HttpError(404, "Track not found.");
      }

      const userId = requestUserId(req);
      const visiblePlaylists = filterPlaylistsForUser(playlists, userId);

      const artist = getPrimaryArtistForTrack(track, artists);
      const inPlaylists = visiblePlaylists.filter((playlist) => playlist.trackIds.includes(trackId));
      const playlistToggles = visiblePlaylists
        .filter((playlist) => isCustomPlaylist(playlist) && playlist.userId === userId)
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

  router.get(
    "/artists/:artistId",
    asyncHandler(async (req, res) => {
      const { artistId } = req.params;
      const { artists, tracks, trackMap, playlists, releases } = await fetchCatalog();
      const artist = artists.find((item) => item.id === artistId);
      if (!artist) {
        throw new HttpError(404, "Artist not found.");
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
      const visiblePlaylists = filterPlaylistsForUser(playlists, requestUserId(req));

      const featuredPlaylists = visiblePlaylists
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

  router.get(
    "/releases/:releaseId",
    asyncHandler(async (req, res) => {
      const { releaseId } = req.params;
      const { artists, trackMap, playlists, releases } = await fetchCatalog();
      const release = releases.find((item) => item.id === releaseId);
      if (!release) {
        throw new HttpError(404, "Release not found.");
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

      const visiblePlaylists = filterPlaylistsForUser(playlists, requestUserId(req));
      const relatedPlaylists = visiblePlaylists
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

  router.get(
    "/smart-recommendations",
    asyncHandler(async (req, res) => {
      const userId = requestUserId(req);
      const recommendations = await getSmartRecommendations({ userId });
      const visiblePlaylists = filterPlaylistsForUser(recommendations.playlists, userId);

      res.json({
        tracks: recommendations.tracks,
        playlists: visiblePlaylists,
        artists: recommendations.artists,
      });
    })
  );

  return router;
}


