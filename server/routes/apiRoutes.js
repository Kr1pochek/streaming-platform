import fs from "node:fs";
import path from "node:path";
import express from "express";
import multer from "multer";
import {
  initialQueue,
  quickActions,
  showcases,
  vibeTags,
} from "../../shared/musicData.js";
import { optionalAuth, requireAuth } from "../middleware/auth.js";
import { requireAdmin, requireSuperAdmin } from "../middleware/adminAuth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { createRateLimiter, resolveRequestIp } from "../middleware/rateLimit.js";
import {
  changeUserPassword,
  createSession,
  createUserAccount,
  pruneExpiredSessions,
  requestPasswordResetToken,
  resetPasswordWithToken,
  revokeSession,
  updateUserProfile,
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
import { ingestUploadedAvatar, removeUploadedAvatar } from "../services/avatarUploadService.js";
import {
  getAdminStats,
  getAdminReleaseFormOptions,
  getAdminReleases,
  getAdminReleasesCount,
  getUploadedTracks,
  getUploadedTracksCount,
  getUsers,
  getUsersCount,
  hideTrack,
  unhideTrack,
  banUser,
  unbanUser,
  createAdminRelease,
  deleteAdminRelease,
  updateAdminRelease,
  updateUserAdminRole,
} from "../services/adminService.js";
import { buildCatalogState, buildHomeGenreTags, buildSearchCollections } from "../services/feedService.js";

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
  [".aac", "audio/aac"],
  [".opus", "audio/ogg"],
]);
const TRACK_UPLOAD_MAX_BYTES = Number(process.env.TRACK_UPLOAD_MAX_BYTES ?? 80 * 1024 * 1024);
const AVATAR_UPLOAD_MAX_BYTES = Number(process.env.AVATAR_UPLOAD_MAX_BYTES ?? 5 * 1024 * 1024);
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
const avatarUploadMiddleware = multer({
  dest: trackUploadTempDirectory,
  limits: {
    fileSize: AVATAR_UPLOAD_MAX_BYTES,
  },
  fileFilter: (_req, file, callback) => {
    const normalizedMimeType = String(file?.mimetype ?? "").trim().toLowerCase();
    if (!normalizedMimeType.startsWith("image/") || normalizedMimeType === "image/svg+xml") {
      callback(new HttpError(400, "Avatar must be a JPG, PNG, WebP, or GIF image."));
      return;
    }
    callback(null, true);
  },
}).single("avatar");

function withUploadMiddleware(middleware, { fileSizeMessage = "" } = {}) {
  return (req, res, next) => {
    middleware(req, res, (error) => {
      if (error?.name === "MulterError" && error.code === "LIMIT_FILE_SIZE" && fileSizeMessage) {
        next(new HttpError(413, fileSizeMessage));
        return;
      }

      next(error);
    });
  };
}

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

function parseBoolean(value, fallback = false) {
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

function shouldExposePasswordResetToken() {
  return parseBoolean(process.env.PASSWORD_RESET_RETURN_TOKEN, false);
}

async function defaultReadinessCheck() {
  await pool.query("select 1;");
  await pool.query("select 1 from schema_migrations limit 1;");
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
  if (userId && playlist.userId === userId) {
    return true;
  }
  return Boolean(playlist.isPublic);
}

function filterPlaylistsForUser(playlists = [], userId = null) {
  return playlists.filter((playlist) => canReadPlaylist(playlist, userId));
}

function playlistsWithTracks(playlists = []) {
  return playlists.filter((playlist) => Array.isArray(playlist?.trackIds) && playlist.trackIds.length > 0);
}

function mapHomeReleaseItem(release, artistNameById = new Map()) {
  return {
    id: `notif-${release.id}`,
    releaseId: release.id,
    artistId: release.artistId,
    artistName: artistNameById.get(release.artistId) ?? "",
    title: release.title,
    type: release.type,
    year: Number(release.year ?? 0),
    cover: release.cover,
    publishedAt: Number(release.publishedAt ?? 0),
    trackIds: Array.isArray(release.trackIds) ? release.trackIds : [],
  };
}

function buildHomeShowcases(playlists = []) {
  const availablePlaylists = playlistsWithTracks(playlists).filter((playlist) => !isCustomPlaylist(playlist));
  if (!availablePlaylists.length) {
    return [];
  }

  const playlistById = new Map(availablePlaylists.map((playlist) => [playlist.id, playlist]));
  const usedPlaylistIds = new Set();
  const prioritizedShowcases = [];

  for (const item of showcases) {
    const playlist = playlistById.get(item.playlistId);
    if (!playlist || usedPlaylistIds.has(playlist.id)) {
      continue;
    }

    usedPlaylistIds.add(playlist.id);
    prioritizedShowcases.push({
      id: item.id,
      playlistId: playlist.id,
      title: item.title || playlist.title,
      subtitle: playlist.subtitle || item.subtitle || `${playlist.trackIds.length} tracks`,
      cover: playlist.cover || item.cover,
      trackIds: playlist.trackIds,
    });
  }

  for (const playlist of availablePlaylists) {
    if (usedPlaylistIds.has(playlist.id)) {
      continue;
    }

    usedPlaylistIds.add(playlist.id);
    prioritizedShowcases.push({
      id: `showcase-${playlist.id}`,
      playlistId: playlist.id,
      title: playlist.title,
      subtitle: playlist.subtitle || `${playlist.trackIds.length} tracks`,
      cover: playlist.cover,
      trackIds: playlist.trackIds,
    });

    if (prioritizedShowcases.length >= 4) {
      break;
    }
  }

  return prioritizedShowcases.slice(0, 4);
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
  readinessCheck = defaultReadinessCheck,
} = {}) {
  const router = express.Router();
  router.use(optionalAuth);

  router.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  router.get("/ready", async (_req, res) => {
    try {
      await readinessCheck();
      res.json({ ok: true, database: "up" });
    } catch {
      res.status(503).json({ ok: false, database: "down" });
    }
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

  router.patch(
    "/auth/profile",
    requireAuth,
    asyncHandler(async (req, res) => {
      const displayName = normalizeTitle(req.body?.displayName);
      const user = await updateUserProfile({
        userId: req.auth.userId,
        displayName,
      });
      res.json({ user });
    })
  );

  router.post(
    "/auth/avatar",
    requireAuth,
    withUploadMiddleware(avatarUploadMiddleware, {
      fileSizeMessage: "Avatar image is too large.",
    }),
    asyncHandler(async (req, res) => {
      const uploadedFile = req.file;
      if (!uploadedFile) {
        throw new HttpError(400, "Avatar image is required.");
      }

      try {
        const user = await ingestUploadedAvatar({
          userId: req.auth.userId,
          uploadFilePath: uploadedFile.path,
          originalFileName: uploadedFile.originalname,
          mimetype: uploadedFile.mimetype,
        });
        res.status(201).json({ user });
      } finally {
        fs.rmSync(uploadedFile.path, { force: true });
      }
    })
  );

  router.delete(
    "/auth/avatar",
    requireAuth,
    asyncHandler(async (req, res) => {
      const user = await removeUploadedAvatar({
        userId: req.auth.userId,
      });
      res.json({ user });
    })
  );

  router.post(
    "/auth/password/change",
    requireAuth,
    asyncHandler(async (req, res) => {
      const currentPassword = String(req.body?.currentPassword ?? "");
      const newPassword = String(req.body?.newPassword ?? "");
      await changeUserPassword({
        userId: req.auth.userId,
        currentPassword,
        newPassword,
      });
      res.json({ success: true });
    })
  );

  router.post(
    "/auth/password/reset/request",
    authRateLimiter,
    asyncHandler(async (req, res) => {
      const username = normalizeTitle(req.body?.username);
      const result = await requestPasswordResetToken({ username });

      if (!shouldExposePasswordResetToken()) {
        res.json({ success: true });
        return;
      }

      res.json({
        success: true,
        resetToken: result.token ?? "",
        expiresAt: result.expiresAt ?? null,
      });
    })
  );

  router.post(
    "/auth/password/reset/confirm",
    authRateLimiter,
    asyncHandler(async (req, res) => {
      const username = normalizeTitle(req.body?.username);
      const token = String(req.body?.token ?? "");
      const newPassword = String(req.body?.newPassword ?? "");
      await resetPasswordWithToken({ username, token, newPassword });
      res.json({ success: true });
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
        savedPlaylistIds: Array.isArray(req.body?.savedPlaylistIds) ? req.body.savedPlaylistIds : [],
        queueTrackIds: Array.isArray(req.body?.queueTrackIds) ? req.body.queueTrackIds : [],
        queueCurrentIndex: req.body?.queueCurrentIndex,
        queueProgressSec: req.body?.queueProgressSec,
        queueIsPlaying: req.body?.queueIsPlaying,
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
          uploaderUserId: req.auth.userId,
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
      const isPublic = parseBoolean(req.body?.isPublic, false);

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
        isPublic,
      };

      await pool.query(
        `
        insert into playlists (id, title, subtitle, cover, is_custom, is_public, created_at, user_id)
        values ($1, $2, $3, $4, true, $5, $6, $7);
      `,
        [playlist.id, playlist.title, playlist.subtitle, playlist.cover, playlist.isPublic, playlist.createdAt, userId]
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
      const hasIsPublic = hasOwnField(payload, "isPublic");

      if (!hasTitle && !hasDescription && !hasCover && !hasIsPublic) {
        throw new HttpError(400, "No fields to update.");
      }

      const nextTitle = hasTitle ? parsePlaylistTitle(payload.title) : null;
      const parsedDescription = hasDescription ? parsePlaylistDescription(payload.description) : "";
      const nextSubtitle = hasDescription ? parsedDescription || CUSTOM_PLAYLIST_SUBTITLE : null;
      const parsedCover = hasCover ? parsePlaylistCover(payload.cover) : "";
      const nextCover = hasCover ? parsedCover || coverForPlaylist(playlistId) : null;
      const nextIsPublic = hasIsPublic ? parseBoolean(payload.isPublic, false) : null;

      const { rowCount } = await pool.query(
        `
        update playlists
        set
          title = case when $2::boolean then $3 else title end,
          subtitle = case when $4::boolean then $5 else subtitle end,
          cover = case when $6::boolean then $7 else cover end,
          is_public = case when $8::boolean then $9 else is_public end
        where id = $1
          and (is_custom = true or id like $10)
          and user_id = $11;
      `,
        [
          playlistId,
          hasTitle,
          nextTitle,
          hasDescription,
          nextSubtitle,
          hasCover,
          nextCover,
          hasIsPublic,
          nextIsPublic,
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

  router.put(
    "/user-playlists/:playlistId/tracks/reorder",
    requireAuth,
    asyncHandler(async (req, res) => {
      const playlistId = req.params.playlistId;
      if (!isCustomPlaylistId(playlistId)) {
        throw new HttpError(400, "Tracks can only be reordered in custom playlists.");
      }

      const inputTrackIds = Array.isArray(req.body?.trackIds) ? req.body.trackIds : null;
      if (!inputTrackIds) {
        throw new HttpError(400, "trackIds array is required.");
      }

      const normalizedTrackIds = inputTrackIds.map((trackId) => normalizeTitle(trackId)).filter(Boolean);
      const uniqueTrackIds = Array.from(new Set(normalizedTrackIds));
      if (uniqueTrackIds.length !== inputTrackIds.length) {
        throw new HttpError(400, "trackIds must be a unique list.");
      }

      await withTransaction(async (client) => {
        await ensureOwnedCustomPlaylist(client, playlistId, req.auth.userId);

        const { rows: currentRows } = await client.query(
          `
          select track_id
          from playlist_tracks
          where playlist_id = $1
          order by position;
        `,
          [playlistId]
        );
        const currentTrackIds = currentRows.map((row) => String(row.track_id ?? "").trim()).filter(Boolean);

        if (currentTrackIds.length !== uniqueTrackIds.length) {
          throw new HttpError(400, "trackIds must contain all playlist tracks exactly once.");
        }

        const currentTrackIdSet = new Set(currentTrackIds);
        const sameTrackSet = uniqueTrackIds.every((trackId) => currentTrackIdSet.has(trackId));
        if (!sameTrackSet) {
          throw new HttpError(400, "trackIds must contain all playlist tracks exactly once.");
        }

        await client.query("delete from playlist_tracks where playlist_id = $1;", [playlistId]);
        for (let index = 0; index < uniqueTrackIds.length; index += 1) {
          await client.query(
            `
            insert into playlist_tracks (playlist_id, track_id, position)
            values ($1, $2, $3);
          `,
            [playlistId, uniqueTrackIds[index], index + 1]
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
    asyncHandler(async (req, res) => {
      const userId = requestUserId(req);
      const { playlists, tracks, trackMap, artists, releases } = await catalogFetcher();
      const visiblePlaylists = filterPlaylistsForUser(playlists, userId);
      const catalogState = buildCatalogState({ tracks, playlists: visiblePlaylists });
      const freshTrackIds = initialQueue.slice(1, 7).filter((trackId) => Boolean(trackMap[trackId]));
      const fallbackFreshTrackIds = tracks.slice(0, 6).map((track) => track.id);
      const enrichedShowcases = buildHomeShowcases(visiblePlaylists);

      const artistNameById = new Map((artists ?? []).map((artist) => [artist.id, artist.name]));
      const sortedReleases = [...(releases ?? [])].sort(
        (first, second) =>
          Number(second.publishedAt ?? 0) - Number(first.publishedAt ?? 0) ||
          Number(second.year ?? 0) - Number(first.year ?? 0) ||
          String(second.id).localeCompare(String(first.id))
      );

      let releaseNotifications = sortedReleases;
      if (userId) {
        const userState = await fetchUserState(userId);
        const followedArtistIdSet = new Set(userState.followedArtistIds ?? []);
        const followedReleases = sortedReleases.filter((release) => followedArtistIdSet.has(release.artistId));
        const remainingReleases = sortedReleases.filter((release) => !followedArtistIdSet.has(release.artistId));
        releaseNotifications = [...followedReleases, ...remainingReleases];
      }
      releaseNotifications = releaseNotifications.slice(0, 8).map((release) => mapHomeReleaseItem(release, artistNameById));

      res.json({
        quickActions,
        showcases: enrichedShowcases,
        vibeTags: buildHomeGenreTags({ tracks, fallbackTags: vibeTags }),
        freshTrackIds: freshTrackIds.length ? freshTrackIds : fallbackFreshTrackIds,
        releaseNotifications,
        catalogState,
      });
    })
  );

  router.get(
    "/search-feed",
    asyncHandler(async (req, res) => {
      const { playlists, tracks, artists } = await fetchCatalog();
      const userId = requestUserId(req);
      const visiblePlaylists = playlistsWithTracks(filterPlaylistsForUser(playlists, userId));
      const catalogState = buildCatalogState({ tracks, playlists: visiblePlaylists });
      const newTrackIds = tracks.slice(-8).map((track) => track.id);
      const morePlaylists = visiblePlaylists
        .filter((playlist) => !isCustomPlaylist(playlist))
        .map((playlist) => ({
        id: playlist.id,
        title: playlist.title,
        artist: playlist.subtitle,
        cover: playlist.cover,
        trackIds: playlist.trackIds,
        }));

      res.json({
        collections: buildSearchCollections({
          playlists: visiblePlaylists,
          tracks,
          artists,
        }),
        newTrackIds,
        morePlaylists,
        catalogState,
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
      const visiblePlaylists = filterPlaylistsForUser(result.playlists, userId).filter(
        (playlist) => playlist.isCustom || (playlist.trackIds?.length ?? 0) > 0
      );
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
      let savedPlaylists = [];
      let followedArtists = [];

      if (userId) {
        const userState = await fetchUserState(userId);
        const followedArtistIdSet = new Set(userState.followedArtistIds ?? []);
        const savedPlaylistIdSet = new Set(userState.savedPlaylistIds ?? []);
        savedPlaylists = visiblePlaylists.filter(
          (playlist) => savedPlaylistIdSet.has(playlist.id) && (!playlist.userId || playlist.userId !== userId)
        );
        followedArtists = artists.filter((artist) => followedArtistIdSet.has(artist.id));
      }

      res.json({
        playlists: myPlaylists,
        savedPlaylists,
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

      const relatedPlaylists = playlistsWithTracks(visiblePlaylists)
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
        .sort(
          (first, second) =>
            Number(second.publishedAt ?? 0) - Number(first.publishedAt ?? 0) ||
            Number(second.year ?? 0) - Number(first.year ?? 0)
        );

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
      const relatedArtists = artists
        .filter((candidate) => candidate.id !== artist.id)
        .map((candidate) => {
          const candidateTracks = tracks.filter((track) => trackHasArtist(track, candidate.name));
          const sharedTagMatches = candidateTracks.filter((track) => track.tags.some((tag) => artistTagSet.has(tag))).length;
          return {
            candidate,
            candidateTrackCount: candidateTracks.length,
            sharedTagMatches,
          };
        })
        .filter(({ candidateTrackCount, sharedTagMatches }) => candidateTrackCount > 0 && sharedTagMatches > 0)
        .sort(
          (first, second) =>
            second.sharedTagMatches - first.sharedTagMatches ||
            second.candidateTrackCount - first.candidateTrackCount ||
            String(first.candidate.name ?? "").localeCompare(String(second.candidate.name ?? ""), "ru")
        )
        .slice(0, 4)
        .map(({ candidate }) => ({ ...candidate }));

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
        .sort(
          (first, second) =>
            Number(second.publishedAt ?? 0) - Number(first.publishedAt ?? 0) ||
            Number(second.year ?? 0) - Number(first.year ?? 0)
        )
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

  // Admin routes
  router.get(
    "/admin/stats",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const stats = await getAdminStats();
      res.json(stats);
    })
  );

  router.get(
    "/admin/tracks",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const limit = parseLimit(req.query.limit, 20);
      const offset = parseOffset(req.query.offset, 0);
      const query = normalizeTitle(req.query.query);
      const status = normalizeTitle(req.query.status).toLowerCase() || "all";
      const tracks = await getUploadedTracks({ limit, offset, query, status });
      const count = await getUploadedTracksCount({ query, status });
      res.json({ tracks, total: count, limit, offset });
    })
  );

  router.get(
    "/admin/release-options",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const artistId = String(req.query.artistId ?? "").trim();
      const options = await getAdminReleaseFormOptions({ artistId });
      res.json(options);
    })
  );

  router.get(
    "/admin/releases",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const limit = parseLimit(req.query.limit, 20);
      const offset = parseOffset(req.query.offset, 0);
      const query = normalizeTitle(req.query.query);
      const status = normalizeTitle(req.query.status).toLowerCase() || "all";
      const releases = await getAdminReleases({ limit, offset, query, status });
      const count = await getAdminReleasesCount({ query, status });
      res.json({ releases, total: count, limit, offset });
    })
  );

  router.post(
    "/admin/releases",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const release = await createAdminRelease(req.body ?? {}, req.auth.userId);
      await invalidateCatalogCache();
      res.json({ success: true, release, message: "Release created" });
    })
  );

  router.put(
    "/admin/releases/:id",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const releaseId = String(req.params.id ?? "").trim();
      const release = await updateAdminRelease(releaseId, req.body ?? {});
      await invalidateCatalogCache();
      res.json({ success: true, release, message: "Release updated" });
    })
  );

  router.delete(
    "/admin/releases/:id",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const releaseId = String(req.params.id ?? "").trim();
      await deleteAdminRelease(releaseId);
      await invalidateCatalogCache();
      res.json({ success: true, message: "Release deleted" });
    })
  );

  router.get(
    "/admin/users",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const limit = parseLimit(req.query.limit, 20);
      const offset = parseOffset(req.query.offset, 0);
      const query = normalizeTitle(req.query.query);
      const status = normalizeTitle(req.query.status).toLowerCase() || "all";
      const users = await getUsers({ limit, offset, query, status });
      const count = await getUsersCount({ query, status });
      res.json({ users, total: count, limit, offset });
    })
  );

  router.post(
    "/admin/tracks/:id/hide",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const trackId = String(req.params.id ?? "").trim();
      const reason = String(req.body?.reason ?? "").trim() || "Content moderation";
      await hideTrack(trackId, req.auth.userId, reason);
      await invalidateCatalogCache();
      res.json({ success: true, message: "Track hidden" });
    })
  );

  router.post(
    "/admin/tracks/:id/unhide",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const trackId = String(req.params.id ?? "").trim();
      await unhideTrack(trackId);
      await invalidateCatalogCache();
      res.json({ success: true, message: "Track unhidden" });
    })
  );

  router.post(
    "/admin/users/:id/role",
    requireAuth,
    requireSuperAdmin,
    asyncHandler(async (req, res) => {
      const userId = String(req.params.id ?? "").trim();
      const role = String(req.body?.role ?? "").trim().toLowerCase();
      const updatedUser = await updateUserAdminRole(userId, role, req.auth.userId);
      res.json({ success: true, user: updatedUser, message: "User role updated" });
    })
  );

  router.post(
    "/admin/users/:id/ban",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const userId = String(req.params.id ?? "").trim();
      const reason = String(req.body?.reason ?? "").trim() || "Policy violation";
      await banUser(userId, reason, req.auth.userId);
      res.json({ success: true, message: "User banned" });
    })
  );

  router.post(
    "/admin/users/:id/unban",
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const userId = String(req.params.id ?? "").trim();
      await unbanUser(userId);
      res.json({ success: true, message: "User unbanned" });
    })
  );

  return router;
}
