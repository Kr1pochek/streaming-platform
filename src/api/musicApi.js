const API_BASE_URL = import.meta.env.VITE_API_URL ?? "/api";
const AUTH_TOKEN_STORAGE_KEY = "music.auth.token.v1";
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

async function request(path, options = {}) {
  const { method = "GET", body, query, headers = {} } = options;

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
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Не удалось подключиться к API-серверу.");
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || "Не удалось загрузить данные. Попробуй обновить страницу.");
  }

  return payload;
}

export async function createUserPlaylist(title) {
  return request("/user-playlists", {
    method: "POST",
    body: { title },
  });
}

export async function renameUserPlaylist(playlistId, title) {
  return request(`/user-playlists/${encodeURIComponent(playlistId)}`, {
    method: "PATCH",
    body: { title },
  });
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

export async function fetchPlayerState() {
  return request("/me/player-state");
}

export async function updatePlayerState(payload) {
  return request("/me/player-state", {
    method: "PUT",
    body: payload,
  });
}
