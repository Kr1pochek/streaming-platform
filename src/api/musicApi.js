const API_BASE_URL = import.meta.env.VITE_API_URL ?? "/api";

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
  const { method = "GET", body, query } = options;

  let response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers: {
        "Content-Type": "application/json",
      },
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
