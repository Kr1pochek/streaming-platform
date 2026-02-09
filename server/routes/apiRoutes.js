import express from "express";
import {
  initialQueue,
  quickActions,
  searchCollections,
  showcases,
  vibeTags,
} from "../../src/data/musicData.js";
import { optionalAuth, requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
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
  invalidateCatalogCache,
  isCustomPlaylist,
  isCustomPlaylistId,
  normalizeTitle,
  pool,
  searchCatalogInDatabase,
  trackHasArtist,
  withTransaction,
} from "../services/catalogService.js";
import { getSmartRecommendations } from "../services/recommendationService.js";
import { fetchUserState, updateUserState } from "../services/userStateService.js";

const authRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 20),
  keyResolver: (req) => `auth:${req.ip}`,
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
    throw new HttpError(404, "Плейлист не найден.");
  }
}

async function ensureTrackExists(client, trackId) {
  const { rowCount } = await client.query("select id from tracks where id = $1 limit 1;", [trackId]);
  if (!rowCount) {
    throw new HttpError(404, "Трек не найден.");
  }
}

export function createApiRouter() {
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
        throw new HttpError(400, "Логин и пароль обязательны.");
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
        throw new HttpError(400, "Логин и пароль обязательны.");
      }

      const user = await verifyUserCredentials({ username, password });
      if (!user) {
        throw new HttpError(401, "Неверный логин или пароль.");
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
    "/user-playlists",
    requireAuth,
    asyncHandler(async (req, res) => {
      const title = normalizeTitle(req.body?.title);
      if (!title) {
        throw new HttpError(400, "Название плейлиста не может быть пустым.");
      }

      const id = createUserPlaylistId();
      const createdAt = Date.now();
      const userId = req.auth.userId;
      const playlist = {
        id,
        title,
        subtitle: CUSTOM_PLAYLIST_SUBTITLE,
        cover: coverForPlaylist(id),
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
        where id = $1
          and (is_custom = true or id like $3)
          and user_id = $4;
      `,
        [playlistId, title, `${USER_PLAYLIST_ID_PREFIX}%`, req.auth.userId]
      );

      if (!rowCount) {
        throw new HttpError(404, "Плейлист не найден.");
      }

      invalidateCatalogCache();
      const playlist = await getPlaylistById(playlistId);
      if (!canReadPlaylist(playlist, req.auth.userId)) {
        throw new HttpError(404, "Плейлист не найден.");
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
        throw new HttpError(400, "Можно удалить только пользовательский плейлист.");
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
        throw new HttpError(404, "Плейлист не найден.");
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
        throw new HttpError(400, "Трек можно добавлять только в пользовательский плейлист.");
      }
      if (!trackId) {
        throw new HttpError(400, "Трек не найден.");
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
        throw new HttpError(404, "Плейлист не найден.");
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
        throw new HttpError(400, "Трек можно удалять только из пользовательского плейлиста.");
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
        throw new HttpError(404, "Плейлист не найден.");
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
      const visiblePlaylists = filterPlaylistsForUser(playlists, requestUserId(req));
      res.json({
        playlists: visiblePlaylists,
        artists,
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
        throw new HttpError(404, "Плейлист не найден.");
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
    "/tracks/:trackId",
    asyncHandler(async (req, res) => {
      const { trackId } = req.params;
      const { artists, tracks, trackMap, playlists } = await fetchCatalog();
      const track = trackMap[trackId];
      if (!track) {
        throw new HttpError(404, "Трек не найден.");
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
