const API_BASE_URL = import.meta.env.VITE_API_URL ?? "/api";
const AUTH_TOKEN_STORAGE_KEY = "music.auth.token.v1";
const RETRYABLE_METHODS = new Set(["GET"]);
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
let authToken = "";

if (typeof window !== "undefined") {
  try {
    authToken = String(window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) ?? "").trim();
  } catch {
    authToken = "";
  }
}

function persistAuthToken(token) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (token) {
      window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    }
  } catch {
    // noop
  }
}

export function getAuthToken() {
  return authToken;
}

export function setAuthToken(token) {
  authToken = String(token ?? "").trim();
  persistAuthToken(authToken);
}

function buildUrl(path, query = null) {
  const normalizedBase = API_BASE_URL.endsWith("/") ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${normalizedBase}${normalizedPath}`;

  if (!query) {
    return url;
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }

  const queryString = params.toString();
  return queryString ? `${url}?${queryString}` : url;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function resolveApiErrorMessage(status, payload, fallbackMessage) {
  const payloadMessage = typeof payload?.message === "string" ? payload.message.trim() : "";
  if (payloadMessage) {
    return payloadMessage;
  }

  if (status === 401) {
    return "Требуется авторизация. Войди в аккаунт и повтори действие.";
  }
  if (status === 403) {
    return "Недостаточно прав для этого действия.";
  }
  if (status === 404) {
    return "Ресурс не найден.";
  }
  if (status === 409) {
    return "Конфликт данных. Обнови страницу и попробуй снова.";
  }
  if (status === 413) {
    return "Файл слишком большой.";
  }
  if (status === 429) {
    return "Слишком много запросов. Попробуй через минуту.";
  }
  if (status >= 500) {
    return "Сервер временно недоступен. Попробуй немного позже.";
  }
  return fallbackMessage;
}

async function request(path, options = {}) {
  const { method = "GET", body, query, headers = {}, retryCount } = options;
  const normalizedMethod = String(method ?? "GET").toUpperCase();
  const canRetry = RETRYABLE_METHODS.has(normalizedMethod);
  const retries = Number.isInteger(retryCount)
    ? Math.min(Math.max(retryCount, 0), 3)
    : canRetry
      ? 1
      : 0;
  const maxAttempts = 1 + retries;

  for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
    let response;
    try {
      const requestHeaders = {
        "Content-Type": "application/json",
        ...headers,
      };
      if (authToken) {
        requestHeaders.Authorization = `Bearer ${authToken}`;
      }

      response = await fetch(buildUrl(path, query), {
        method: normalizedMethod,
        headers: requestHeaders,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      if (attemptIndex < maxAttempts - 1) {
        await delay(260 * (attemptIndex + 1));
        continue;
      }
      throw new Error("Не удалось подключиться к серверу. Проверь интернет и повтори попытку.");
    }

    const payload = await response.json().catch(() => ({}));
    if (response.ok) {
      return payload;
    }

    const shouldRetry =
      attemptIndex < maxAttempts - 1 &&
      canRetry &&
      RETRYABLE_STATUSES.has(response.status);
    if (shouldRetry) {
      await delay(260 * (attemptIndex + 1));
      continue;
    }

    throw new Error(
      resolveApiErrorMessage(response.status, payload, "Не удалось загрузить данные. Обнови страницу и попробуй снова.")
    );
  }

  throw new Error("Не удалось загрузить данные. Обнови страницу и попробуй снова.");
}

async function requestMultipart(path, { method = "POST", formData, fallbackMessage } = {}) {
  let response;
  try {
    const headers = {};
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    response = await fetch(buildUrl(path), {
      method: String(method ?? "POST").toUpperCase(),
      headers,
      body: formData,
    });
  } catch {
    throw new Error("РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕРґРєР»СЋС‡РёС‚СЊСЃСЏ Рє СЃРµСЂРІРµСЂСѓ. РџСЂРѕРІРµСЂСЊ РёРЅС‚РµСЂРЅРµС‚ Рё РїРѕРІС‚РѕСЂРё РїРѕРїС‹С‚РєСѓ.");
  }

  const responsePayload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      resolveApiErrorMessage(
        response.status,
        responsePayload,
        fallbackMessage || "РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ С„Р°Р№Р». РџРѕРїСЂРѕР±СѓР№ СЃРЅРѕРІР°."
      )
    );
  }

  return responsePayload;
}

function normalizeUserPlaylistPayload(payloadOrTitle) {
  if (typeof payloadOrTitle === "string") {
    return { title: payloadOrTitle };
  }

  if (payloadOrTitle && typeof payloadOrTitle === "object") {
    return {
      title: payloadOrTitle.title,
      description: payloadOrTitle.description,
      cover: payloadOrTitle.cover,
      isPublic: payloadOrTitle.isPublic,
    };
  }

  return {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeIdList(values = []) {
  const seen = new Set();
  const ids = [];

  for (const value of values) {
    const id = String(value ?? "").trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id);
  }

  return ids;
}

function normalizeCover(value) {
  const cover = asString(value);
  if (!cover) {
    return "";
  }

  if (/^(url\(|linear-gradient\(|radial-gradient\(|conic-gradient\()/i.test(cover)) {
    return cover;
  }

  if (/^(data:image\/|https?:\/\/|\/)/i.test(cover)) {
    return `url("${cover}") center / cover no-repeat`;
  }

  return cover;
}

function normalizeArtistLine(value, artists = []) {
  const directValue = asString(value);
  if (directValue) {
    return directValue;
  }

  return artists
    .map((artist) => asString(typeof artist === "string" ? artist : artist?.name))
    .filter(Boolean)
    .join(", ");
}

function normalizeArtistSummary(artist = {}) {
  const rawFollowers = artist?.followers;
  const followers =
    typeof rawFollowers === "string"
      ? rawFollowers.trim()
      : Number.isFinite(rawFollowers)
        ? String(rawFollowers)
        : Number.isFinite(Number(rawFollowers))
          ? String(Number(rawFollowers))
          : "0";

  return {
    ...artist,
    id: asString(artist.id),
    name: asString(artist.name),
    followers,
  };
}

function normalizeTrack(track = {}) {
  const artists = asArray(track.artists).map((artist) =>
    typeof artist === "string"
      ? { id: "", name: asString(artist) }
      : {
          ...artist,
          id: asString(artist?.id),
          name: asString(artist?.name),
        }
  );

  const artistLine = normalizeArtistLine(track.artist ?? track.artistName, artists);
  const artistIds = normalizeIdList(
    asArray(track.artistIds).length
      ? track.artistIds
      : artists.map((artist) => artist.id)
  );

  return {
    ...track,
    id: asString(track.id),
    title: asString(track.title),
    artist: artistLine,
    artistName: asString(track.artistName) || artistLine,
    artistIds,
    artists,
    cover: normalizeCover(track.cover),
    durationSec: asNumber(track.durationSec, 0),
    explicit: Boolean(track.explicit),
    tags: asArray(track.tags)
      .map((tag) => String(tag ?? "").trim())
      .filter(Boolean),
    audioUrl: asString(track.audioUrl),
    rawAudioUrl: asString(track.rawAudioUrl),
    hlsUrl: asString(track.hlsUrl),
  };
}

function normalizeTrackIds(trackIds = [], tracks = []) {
  const normalizedTrackIds = normalizeIdList(trackIds);
  if (normalizedTrackIds.length) {
    return normalizedTrackIds;
  }
  return normalizeIdList(asArray(tracks).map((track) => track?.id));
}

function normalizePlaylistSummary(playlist = {}) {
  const tracks = asArray(playlist.tracks).map(normalizeTrack);
  const subtitle = asString(playlist.subtitle) || asString(playlist.artist) || asString(playlist.description);

  return {
    ...playlist,
    id: asString(playlist.id),
    title: asString(playlist.title),
    subtitle,
    artist: asString(playlist.artist) || subtitle,
    description: asString(playlist.description) || subtitle,
    cover: normalizeCover(playlist.cover),
    trackIds: normalizeTrackIds(playlist.trackIds, tracks),
    tracks,
    isCustom: Boolean(playlist.isCustom),
    isPublic: Boolean(playlist.isPublic),
    userId: asString(playlist.userId),
  };
}

function normalizeReleaseSummary(release = {}) {
  const tracks = asArray(release.tracks).map(normalizeTrack);
  const artists = asArray(release.artists);
  const artistName = asString(release.artistName) || normalizeArtistLine(release.artist, artists);

  return {
    ...release,
    id: asString(release.id),
    title: asString(release.title),
    type: asString(release.type) || "release",
    artist: asString(release.artist) || artistName,
    artistName,
    cover: normalizeCover(release.cover),
    year: asNumber(release.year, 0),
    tracks,
    trackIds: normalizeTrackIds(release.trackIds, tracks),
  };
}

function normalizePagination(pagination = {}) {
  return {
    limit: asNumber(pagination.limit, 12),
    offset: asNumber(pagination.offset, 0),
    hasMore: Boolean(pagination.hasMore),
    nextOffset: Number.isFinite(Number(pagination.nextOffset)) ? Number(pagination.nextOffset) : null,
  };
}

function normalizeCollection(item = {}) {
  return {
    ...item,
    id: asString(item.id),
    title: asString(item.title),
    subtitle: asString(item.subtitle),
    gradient: asString(item.gradient),
    type: asString(item.type),
    targetId: asString(item.targetId),
    query: asString(item.query),
  };
}

function normalizeQuickAction(item = {}) {
  return {
    ...item,
    id: asString(item.id),
    title: asString(item.title),
    subtitle: asString(item.subtitle),
    accent: asString(item.accent),
  };
}

function normalizeReleaseNotification(item = {}) {
  return {
    ...item,
    id: asString(item.id),
    releaseId: asString(item.releaseId),
    artistId: asString(item.artistId),
    title: asString(item.title),
    artistName: asString(item.artistName),
    type: asString(item.type),
    year: asNumber(item.year, 0),
    publishedAt: asNumber(item.publishedAt, 0),
    cover: normalizeCover(item.cover),
    trackIds: normalizeTrackIds(item.trackIds),
  };
}

function normalizeSearchArtist(item = {}) {
  const rawFollowers = item?.followers;
  const followers =
    typeof rawFollowers === "string"
      ? rawFollowers.trim()
      : Number.isFinite(rawFollowers)
        ? String(rawFollowers)
        : Number.isFinite(Number(rawFollowers))
          ? String(Number(rawFollowers))
          : "0";

  return {
    ...item,
    id: asString(item.id),
    name: asString(item.name),
    followers,
  };
}

function normalizeUser(user = {}) {
  const username = asString(user.username);
  return {
    ...user,
    id: asString(user.id),
    username,
    displayName: asString(user.displayName ?? user.display_name) || username,
    avatarUrl: asString(user.avatarUrl ?? user.avatar_url),
    createdAt: asNumber(user.createdAt ?? user.created_at, 0),
    adminRole: asString(user.adminRole ?? user.admin_role) || "user",
    isAdmin: Boolean(user.isAdmin ?? user.is_admin),
    isSuperAdmin: Boolean(user.isSuperAdmin),
    isBanned: Boolean(user.isBanned ?? user.is_banned),
  };
}

function normalizeAuthPayload(payload = {}) {
  return {
    ...payload,
    user: payload?.user ? normalizeUser(payload.user) : null,
  };
}

function normalizeCatalogMapPayload(payload = {}) {
  return {
    ...payload,
    tracks: asArray(payload.tracks).map(normalizeTrack),
    artists: asArray(payload.artists).map(normalizeArtistSummary),
  };
}

function normalizeHomeFeedPayload(payload = {}) {
  return {
    ...payload,
    quickActions: asArray(payload.quickActions).map(normalizeQuickAction),
    showcases: asArray(payload.showcases).map((item) => ({
      ...item,
      id: asString(item.id),
      title: asString(item.title),
      subtitle: asString(item.subtitle),
      cover: normalizeCover(item.cover),
      playlistId: asString(item.playlistId),
      trackIds: normalizeTrackIds(item.trackIds),
    })),
    releaseNotifications: asArray(payload.releaseNotifications).map(normalizeReleaseNotification),
    freshTrackIds: normalizeIdList(payload.freshTrackIds),
    vibeTags: asArray(payload.vibeTags)
      .map((tag) => String(tag ?? "").trim())
      .filter(Boolean),
    catalogState:
      payload.catalogState && typeof payload.catalogState === "object"
        ? payload.catalogState
        : {},
  };
}

function normalizeSearchFeedPayload(payload = {}) {
  return {
    ...payload,
    collections: asArray(payload.collections).map(normalizeCollection),
    morePlaylists: asArray(payload.morePlaylists).map(normalizePlaylistSummary),
    newTrackIds: normalizeIdList(payload.newTrackIds),
    catalogState:
      payload.catalogState && typeof payload.catalogState === "object"
        ? payload.catalogState
        : {},
  };
}

function normalizeSearchResultPayload(payload = {}) {
  return {
    ...payload,
    tracks: asArray(payload.tracks).map(normalizeTrack),
    playlists: asArray(payload.playlists).map(normalizePlaylistSummary),
    artists: asArray(payload.artists).map(normalizeSearchArtist),
    albums: asArray(payload.albums).map(normalizeReleaseSummary),
    pagination: normalizePagination(payload.pagination),
  };
}

function normalizeLibraryFeedPayload(payload = {}) {
  return {
    ...payload,
    artists: asArray(payload.artists).map(normalizeArtistSummary),
    playlists: asArray(payload.playlists).map(normalizePlaylistSummary),
    savedPlaylists: asArray(payload.savedPlaylists).map(normalizePlaylistSummary),
  };
}

function normalizePlaylistPagePayload(payload = {}) {
  const playlist = normalizePlaylistSummary(payload.playlist);
  const tracks = asArray(payload.tracks).map(normalizeTrack);

  return {
    ...payload,
    playlist: {
      ...playlist,
      trackIds: playlist.trackIds.length ? playlist.trackIds : normalizeTrackIds([], tracks),
    },
    tracks,
    relatedPlaylists: asArray(payload.relatedPlaylists).map(normalizePlaylistSummary),
  };
}

function normalizeTrackPagePayload(payload = {}) {
  return {
    ...payload,
    track: normalizeTrack(payload.track),
    artist: payload.artist ? normalizeArtistSummary(payload.artist) : null,
    inPlaylists: asArray(payload.inPlaylists).map(normalizePlaylistSummary),
    playlistToggles: asArray(payload.playlistToggles).map((playlist) => ({
      ...normalizePlaylistSummary(playlist),
      hasTrack: Boolean(playlist?.hasTrack),
    })),
    relatedTracks: asArray(payload.relatedTracks).map(normalizeTrack),
    moreByArtist: asArray(payload.moreByArtist).map(normalizeTrack),
  };
}

function normalizeArtistPagePayload(payload = {}) {
  return {
    ...payload,
    artist: normalizeArtistSummary(payload.artist),
    topTracks: asArray(payload.topTracks).map(normalizeTrack),
    latestRelease: payload.latestRelease ? normalizeReleaseSummary(payload.latestRelease) : null,
    popularAlbums: asArray(payload.popularAlbums).map(normalizeReleaseSummary),
    eps: asArray(payload.eps).map(normalizeReleaseSummary),
    singles: asArray(payload.singles).map(normalizeReleaseSummary),
    relatedArtists: asArray(payload.relatedArtists).map(normalizeArtistSummary),
  };
}

function normalizeReleasePagePayload(payload = {}) {
  const tracks = asArray(payload.tracks).map(normalizeTrack);
  const release = normalizeReleaseSummary(payload.release);

  return {
    ...payload,
    release: {
      ...release,
      trackIds: release.trackIds.length ? release.trackIds : normalizeTrackIds([], tracks),
    },
    tracks,
    totalDurationSec: asNumber(
      payload.totalDurationSec,
      tracks.reduce((sum, track) => sum + asNumber(track.durationSec, 0), 0)
    ),
    moreReleasesByArtist: asArray(payload.moreReleasesByArtist).map(normalizeReleaseSummary),
    relatedPlaylists: asArray(payload.relatedPlaylists).map(normalizePlaylistSummary),
  };
}

export async function createUserPlaylist(payloadOrTitle) {
  const payload = normalizeUserPlaylistPayload(payloadOrTitle);
  return request("/user-playlists", {
    method: "POST",
    body: payload,
  });
}

export async function updateUserPlaylist(playlistId, payloadOrTitle) {
  const payload = normalizeUserPlaylistPayload(payloadOrTitle);
  return request(`/user-playlists/${encodeURIComponent(playlistId)}`, {
    method: "PATCH",
    body: payload,
  });
}

export async function renameUserPlaylist(playlistId, title) {
  return updateUserPlaylist(playlistId, { title });
}

export async function deleteUserPlaylist(playlistId) {
  return request(`/user-playlists/${encodeURIComponent(playlistId)}`, {
    method: "DELETE",
  });
}

export async function addTrackToUserPlaylist(playlistId, trackId) {
  return request(`/user-playlists/${encodeURIComponent(playlistId)}/tracks`, {
    method: "POST",
    body: { trackId },
  });
}

export async function removeTrackFromUserPlaylist(playlistId, trackId) {
  return request(`/user-playlists/${encodeURIComponent(playlistId)}/tracks/${encodeURIComponent(trackId)}`, {
    method: "DELETE",
  });
}

export async function reorderUserPlaylistTracks(playlistId, trackIds = []) {
  return request(`/user-playlists/${encodeURIComponent(playlistId)}/tracks/reorder`, {
    method: "PUT",
    body: { trackIds },
  });
}

export async function fetchHomeFeed() {
  return normalizeHomeFeedPayload(await request("/home-feed"));
}

export async function fetchSearchFeed() {
  return normalizeSearchFeedPayload(await request("/search-feed"));
}

export async function searchCatalog(query, options = {}) {
  return normalizeSearchResultPayload(
    await request("/search", {
      query: {
        query,
        filter: options.filter ?? "all",
        limit: options.limit ?? 12,
        offset: options.offset ?? 0,
      },
    })
  );
}

export async function fetchLibraryFeed() {
  return normalizeLibraryFeedPayload(await request("/library-feed"));
}

export async function fetchCatalogMap() {
  return normalizeCatalogMapPayload(await request("/catalog-map"));
}

export async function fetchPlaylistPage(playlistId) {
  return normalizePlaylistPagePayload(await request(`/playlists/${encodeURIComponent(playlistId)}`));
}

export async function fetchTrackPage(trackId) {
  return normalizeTrackPagePayload(await request(`/tracks/${encodeURIComponent(trackId)}`));
}

export async function fetchTrackPlayback(trackId) {
  return request(`/playback/${encodeURIComponent(trackId)}`);
}

export async function fetchArtistPage(artistId) {
  return normalizeArtistPagePayload(await request(`/artists/${encodeURIComponent(artistId)}`));
}

export async function fetchReleasePage(releaseId) {
  return normalizeReleasePagePayload(await request(`/releases/${encodeURIComponent(releaseId)}`));
}

export async function fetchSmartRecommendations() {
  return request("/smart-recommendations");
}

export async function registerAuth(payload) {
  const response = normalizeAuthPayload(
    await request("/auth/register", {
      method: "POST",
      body: payload,
    })
  );
  if (response?.token) {
    setAuthToken(response.token);
  }
  return response;
}

export async function loginAuth(payload) {
  const response = normalizeAuthPayload(
    await request("/auth/login", {
      method: "POST",
      body: payload,
    })
  );
  if (response?.token) {
    setAuthToken(response.token);
  }
  return response;
}

export async function logoutAuth() {
  try {
    await request("/auth/logout", { method: "POST" });
  } finally {
    setAuthToken("");
  }
}

export async function fetchCurrentUser() {
  return normalizeAuthPayload(await request("/auth/me"));
}

export async function updateAuthProfile(payload) {
  return normalizeAuthPayload(
    await request("/auth/profile", {
      method: "PATCH",
      body: payload,
    })
  );
}

export async function uploadAuthAvatar(file) {
  const canCheckBlob = typeof Blob !== "undefined";
  if (!file || (canCheckBlob && !(file instanceof Blob))) {
    throw new Error("Р’С‹Р±РµСЂРё РёР·РѕР±СЂР°Р¶РµРЅРёРµ РґР»СЏ Р°РІР°С‚Р°СЂР°.");
  }

  const formData = new FormData();
  const fileName = typeof file?.name === "string" && file.name.trim() ? file.name.trim() : "avatar.jpg";
  formData.append("avatar", file, fileName);

  return normalizeAuthPayload(
    await requestMultipart("/auth/avatar", {
      method: "POST",
      formData,
      fallbackMessage: "РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±РЅРѕРІРёС‚СЊ Р°РІР°С‚Р°СЂ. РџРѕРїСЂРѕР±СѓР№ СЃРЅРѕРІР°.",
    })
  );
}

export async function removeAuthAvatar() {
  return normalizeAuthPayload(
    await request("/auth/avatar", {
      method: "DELETE",
    })
  );
}

export async function changeAuthPassword(payload) {
  return request("/auth/password/change", {
    method: "POST",
    body: payload,
  });
}

export async function requestPasswordReset(payload) {
  return request("/auth/password/reset/request", {
    method: "POST",
    body: payload,
  });
}

export async function confirmPasswordReset(payload) {
  return request("/auth/password/reset/confirm", {
    method: "POST",
    body: payload,
  });
}

export async function fetchPlayerState() {
  return request("/me/player-state");
}

export async function updatePlayerState(payload) {
  return request("/me/player-state", {
    method: "PUT",
    body: payload,
  });
}

export async function uploadTrack(payload = {}) {
  const formData = new FormData();
  const canCheckFile = typeof File !== "undefined";
  const canCheckBlob = typeof Blob !== "undefined";
  const isFile = canCheckFile && payload.audio instanceof File;
  const isBlob = canCheckBlob && payload.audio instanceof Blob;
  if (isFile || isBlob) {
    const fileName = isFile ? payload.audio.name : "track.mp3";
    formData.append("audio", payload.audio, fileName);
  }

  const optionalFields = [
    ["trackId", payload.trackId],
    ["title", payload.title],
    ["artist", payload.artist],
    ["durationSec", payload.durationSec],
    ["explicit", payload.explicit],
    ["cover", payload.cover],
    ["tags", payload.tags],
  ];
  for (const [key, value] of optionalFields) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    if (Array.isArray(value)) {
      formData.append(key, value.join(","));
      continue;
    }
    formData.append(key, String(value));
  }

  return requestMultipart("/tracks/upload", {
    method: "POST",
    formData,
    fallbackMessage: "Не удалось загрузить трек. Попробуй снова.",
  });
}

export async function getAdminStats() {
  return request("/admin/stats");
}

export async function getAdminTracks(optionsOrLimit = 20, offset = 0) {
  const options =
    typeof optionsOrLimit === "object" && optionsOrLimit !== null
      ? optionsOrLimit
      : { limit: optionsOrLimit, offset };

  return request("/admin/tracks", {
    query: {
      limit: options.limit ?? 20,
      offset: options.offset ?? 0,
      query: options.query ?? "",
      status: options.status ?? "all",
    },
  });
}

export async function getAdminReleases(optionsOrLimit = 20, offset = 0) {
  const options =
    typeof optionsOrLimit === "object" && optionsOrLimit !== null
      ? optionsOrLimit
      : { limit: optionsOrLimit, offset };

  return request("/admin/releases", {
    query: {
      limit: options.limit ?? 20,
      offset: options.offset ?? 0,
      query: options.query ?? "",
      status: options.status ?? "all",
    },
  });
}

export async function getAdminReleaseOptions(artistId = "") {
  return request("/admin/release-options", {
    query: {
      artistId,
    },
  });
}

export async function createAdminRelease(payload = {}) {
  return request("/admin/releases", {
    method: "POST",
    body: payload,
  });
}

export async function updateAdminRelease(releaseId, payload = {}) {
  return request(`/admin/releases/${encodeURIComponent(releaseId)}`, {
    method: "PUT",
    body: payload,
  });
}

export async function deleteAdminRelease(releaseId) {
  return request(`/admin/releases/${encodeURIComponent(releaseId)}`, {
    method: "DELETE",
  });
}

export async function getAdminUsers(optionsOrLimit = 20, offset = 0) {
  const options =
    typeof optionsOrLimit === "object" && optionsOrLimit !== null
      ? optionsOrLimit
      : { limit: optionsOrLimit, offset };

  return request("/admin/users", {
    query: {
      limit: options.limit ?? 20,
      offset: options.offset ?? 0,
      query: options.query ?? "",
      status: options.status ?? "all",
    },
  });
}

export async function updateAdminUserRole(userId, role) {
  return request(`/admin/users/${encodeURIComponent(userId)}/role`, {
    method: "POST",
    body: { role },
  });
}

export async function hideAdminTrack(trackId, reason = "") {
  return request(`/admin/tracks/${trackId}/hide`, {
    method: "POST",
    body: { reason },
  });
}

export async function unhideAdminTrack(trackId) {
  return request(`/admin/tracks/${trackId}/unhide`, {
    method: "POST",
  });
}

export async function banAdminUser(userId, reason = "") {
  return request(`/admin/users/${userId}/ban`, {
    method: "POST",
    body: { reason },
  });
}

export async function unbanAdminUser(userId) {
  return request(`/admin/users/${userId}/unban`, {
    method: "POST",
  });
}
