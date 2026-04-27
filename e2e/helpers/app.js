import { expect } from "@playwright/test";

export const HOME_TITLE = "Музыка, которая попадает в настроение.";
export const EMPTY_PLAYER_TITLE = "Нет трека";

export function getPlayerTitle(page) {
  return page.getByTestId("player-current-track-button");
}

export async function expectHomeLoaded(page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: HOME_TITLE })).toBeVisible();
}

export async function startWave(page) {
  const playerTitle = getPlayerTitle(page);

  await page.getByTestId("home-wave-button").click();
  await expect(page.getByTestId("player-play-toggle")).toHaveAttribute("aria-label", "Пауза");
  await expect(playerTitle).not.toHaveText(EMPTY_PLAYER_TITLE);

  return playerTitle;
}

async function apiGetJson(request, path) {
  const response = await request.get(path);
  if (!response.ok()) {
    throw new Error(`GET ${path} failed with status ${response.status()}.`);
  }

  return response.json();
}

function pickFirstWithId(items = []) {
  return Array.isArray(items) ? items.find((item) => item?.id) ?? null : null;
}

function pickFirstTrackCollectionTrack(tracks = []) {
  return Array.isArray(tracks) ? tracks.find((track) => track?.id && track?.title) ?? null : null;
}

export function searchTokenFromTitle(title) {
  const normalizedTitle = String(title ?? "").trim();
  if (!normalizedTitle) {
    return "";
  }

  const tokens = normalizedTitle
    .split(/[\s()[\]{}"'`.,!?/:;|\\-]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  return tokens.find((token) => token.length >= 3) ?? normalizedTitle;
}

export async function resolveCatalogEntities(request) {
  const [catalogMap, homeFeed, searchFeed] = await Promise.all([
    apiGetJson(request, "/api/catalog-map"),
    apiGetJson(request, "/api/home-feed"),
    apiGetJson(request, "/api/search-feed"),
  ]);

  const track = pickFirstTrackCollectionTrack(catalogMap?.tracks);
  if (!track?.id) {
    throw new Error("The catalog did not return a playable track.");
  }

  const trackPage = await apiGetJson(request, `/api/tracks/${encodeURIComponent(track.id)}`);
  const artistId =
    trackPage?.artist?.id ??
    track?.artistIds?.[0] ??
    trackPage?.track?.artistIds?.[0] ??
    searchFeed?.collections?.find((item) => item?.type === "artist" && item?.targetId)?.targetId ??
    homeFeed?.releaseNotifications?.find((item) => item?.artistId)?.artistId ??
    "";

  if (!artistId) {
    throw new Error(`The track ${track.id} did not resolve to an artist page.`);
  }

  const artistPage = await apiGetJson(request, `/api/artists/${encodeURIComponent(artistId)}`);
  const releaseId =
    artistPage?.latestRelease?.id ??
    pickFirstWithId(artistPage?.popularAlbums)?.id ??
    pickFirstWithId(artistPage?.eps)?.id ??
    pickFirstWithId(artistPage?.singles)?.id ??
    homeFeed?.releaseNotifications?.find((item) => item?.releaseId)?.releaseId ??
    "";

  if (!releaseId) {
    throw new Error(`The artist ${artistId} did not resolve to a release page.`);
  }

  const playlistId =
    pickFirstWithId(trackPage?.inPlaylists)?.id ??
    pickFirstWithId(searchFeed?.morePlaylists)?.id ??
    homeFeed?.showcases?.find((item) => item?.playlistId)?.playlistId ??
    searchFeed?.collections?.find((item) => item?.type === "playlist" && item?.targetId)?.targetId ??
    "";

  if (!playlistId) {
    throw new Error(`The catalog did not expose a playlist page for track ${track.id}.`);
  }

  const [releasePage, playlistPage] = await Promise.all([
    apiGetJson(request, `/api/releases/${encodeURIComponent(releaseId)}`),
    apiGetJson(request, `/api/playlists/${encodeURIComponent(playlistId)}`),
  ]);

  if (!releasePage?.release?.id || !(releasePage?.tracks?.length > 0 || releasePage?.release?.trackIds?.length > 0)) {
    throw new Error(`The release ${releaseId} is not playable.`);
  }

  if (
    !playlistPage?.playlist?.id ||
    !(playlistPage?.tracks?.length > 0 || playlistPage?.playlist?.trackIds?.length > 0)
  ) {
    throw new Error(`The playlist ${playlistId} is not playable.`);
  }

  return {
    track,
    trackPage,
    artist: artistPage.artist,
    artistPage,
    release: releasePage.release,
    releasePage,
    playlist: playlistPage.playlist,
    playlistPage,
  };
}
