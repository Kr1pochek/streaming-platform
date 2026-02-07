import {
  artists,
  historySeeds,
  initialQueue,
  playlists,
  quickActions,
  searchCollections,
  showcases,
  tracks,
  vibeTags,
} from "../data/musicData.js";

const API_DELAY_MS = 320;

function clone(data) {
  return JSON.parse(JSON.stringify(data));
}

function delayed(data, shouldFail = false) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (shouldFail) {
        reject(new Error("Не удалось загрузить данные. Попробуй обновить страницу."));
        return;
      }
      resolve(clone(data));
    }, API_DELAY_MS);
  });
}

function includesText(text, query) {
  return text.toLowerCase().includes(query.toLowerCase());
}

export async function fetchHomeFeed(options = {}) {
  const freshTrackIds = initialQueue.slice(1, 7);
  return delayed(
    {
      quickActions,
      showcases,
      vibeTags,
      freshTrackIds,
    },
    options.fail
  );
}

export async function fetchSearchFeed(options = {}) {
  const newTrackIds = tracks.slice(-8).map((track) => track.id);
  const morePlaylists = playlists.map((item) => ({
    id: item.id,
    title: item.title,
    artist: item.subtitle,
    cover: item.cover,
  }));

  return delayed(
    {
      collections: searchCollections,
      newTrackIds,
      morePlaylists,
      historyTrackIds: historySeeds,
    },
    options.fail
  );
}

export async function searchCatalog(query, options = {}) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return delayed({ tracks: [], playlists: [], artists: [] }, options.fail);
  }

  const foundTracks = tracks.filter((track) =>
    [track.title, track.artist].some((field) => includesText(field, normalized))
  );
  const foundPlaylists = playlists.filter((playlist) =>
    [playlist.title, playlist.subtitle].some((field) => includesText(field, normalized))
  );
  const foundArtists = artists.filter((artist) => includesText(artist.name, normalized));

  return delayed(
    {
      tracks: foundTracks,
      playlists: foundPlaylists,
      artists: foundArtists,
    },
    options.fail
  );
}

export async function fetchLibraryFeed(options = {}) {
  return delayed(
    {
      playlists,
      artists,
    },
    options.fail
  );
}

export async function fetchCatalogMap(options = {}) {
  const trackMap = Object.fromEntries(tracks.map((track) => [track.id, track]));
  return delayed({ tracks, trackMap, playlists, artists }, options.fail);
}
