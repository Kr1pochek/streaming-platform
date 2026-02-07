import { artists } from "../data/musicData.js";

function normalizeName(value = "") {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function splitArtistNames(value = "") {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const artistNameToIdMap = new Map(artists.map((artist) => [normalizeName(artist.name), artist.id]));

export function findArtistIdByName(name) {
  return artistNameToIdMap.get(normalizeName(name)) ?? null;
}

export function findArtistIdByTrackArtist(artistLine) {
  const artistNames = splitArtistNames(artistLine);
  for (const artistName of artistNames) {
    const artistId = findArtistIdByName(artistName);
    if (artistId) {
      return artistId;
    }
  }
  return null;
}

export function resolveArtistLine(artistLine = "") {
  return splitArtistNames(artistLine).map((name) => ({
    name,
    id: findArtistIdByName(name),
  }));
}

export function resolveArtistIds(artistLine = "") {
  const ids = [];
  for (const artist of resolveArtistLine(artistLine)) {
    if (artist.id && !ids.includes(artist.id)) {
      ids.push(artist.id);
    }
  }
  return ids;
}
