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

function normalizeUserPlaylistPayload(payloadOrTitle) {
  if (typeof payloadOrTitle === "string") {
    return { title: payloadOrTitle };
  }

  if (payloadOrTitle && typeof payloadOrTitle === "object") {
    return {
      title: payloadOrTitle.title,
      description: payloadOrTitle.description,
      cover: payloadOrTitle.cover,
    };
  }

  return {};
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
  return request("/home-feed");
}

export async function fetchSearchFeed() {
  return request("/search-feed");
}

export async function searchCatalog(query, options = {}) {
  return request("/search", {
    query: {
      query,
      filter: options.filter ?? "all",
      limit: options.limit ?? 12,
      offset: options.offset ?? 0,
    },
  });
}

export async function fetchLibraryFeed() {
  return request("/library-feed");
}

export async function fetchCatalogMap() {
  return request("/catalog-map");
}

export async function fetchPlaylistPage(playlistId) {
  return request(`/playlists/${encodeURIComponent(playlistId)}`);
}

export async function fetchTrackPage(trackId) {
  return request(`/tracks/${encodeURIComponent(trackId)}`);
}

export async function fetchTrackPlayback(trackId) {
  return request(`/playback/${encodeURIComponent(trackId)}`);
}

export async function fetchArtistPage(artistId) {
  return request(`/artists/${encodeURIComponent(artistId)}`);
}

export async function fetchReleasePage(releaseId) {
  return request(`/releases/${encodeURIComponent(releaseId)}`);
}

export async function fetchSmartRecommendations() {
  return request("/smart-recommendations");
}

export async function registerAuth(payload) {
  const response = await request("/auth/register", {
    method: "POST",
    body: payload,
  });
  if (response?.token) {
    setAuthToken(response.token);
  }
  return response;
}

export async function loginAuth(payload) {
  const response = await request("/auth/login", {
    method: "POST",
    body: payload,
  });
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
  return request("/auth/me");
}

export async function updateAuthProfile(payload) {
  return request("/auth/profile", {
    method: "PATCH",
    body: payload,
  });
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

  let response;
  try {
    const headers = {};
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }
    response = await fetch(buildUrl("/tracks/upload"), {
      method: "POST",
      headers,
      body: formData,
    });
  } catch {
    throw new Error("Не удалось подключиться к серверу. Проверь интернет и повтори попытку.");
  }

  const responsePayload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      resolveApiErrorMessage(response.status, responsePayload, "Не удалось загрузить трек. Попробуй снова.")
    );
  }
  return responsePayload;
}
