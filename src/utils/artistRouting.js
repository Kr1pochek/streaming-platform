function normalizeName(value = "") {
  return String(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function splitArtistNames(value = "") {
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function artistNameToIdMap(artists = []) {
  const map = new Map();
  for (const artist of artists) {
    const id = String(artist?.id ?? "").trim();
    const name = normalizeName(artist?.name ?? "");
    if (!id || !name || map.has(name)) {
      continue;
    }
    map.set(name, id);
  }
  return map;
}

export function findArtistIdByName(name, artists = []) {
  return artistNameToIdMap(artists).get(normalizeName(name)) ?? null;
}

export function findArtistIdByTrackArtist(artistLine, artists = []) {
  const map = artistNameToIdMap(artists);
  const artistNames = splitArtistNames(artistLine);
  for (const artistName of artistNames) {
    const artistId = map.get(normalizeName(artistName));
    if (artistId) {
      return artistId;
    }
  }
  return null;
}

export function resolveArtistLine(artistLine = "", artists = []) {
  const map = artistNameToIdMap(artists);
  return splitArtistNames(artistLine).map((name) => ({
    name,
    id: map.get(normalizeName(name)) ?? null,
  }));
}

export function resolveArtistIds(artistLine = "", artists = []) {
  const ids = [];
  for (const artist of resolveArtistLine(artistLine, artists)) {
    if (artist.id && !ids.includes(artist.id)) {
      ids.push(artist.id);
    }
  }
  return ids;
}
