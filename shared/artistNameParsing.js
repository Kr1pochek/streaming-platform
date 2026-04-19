const artistSeparatorPattern = /(?:\s*,\s*|\s+(?:featuring|feat\.?|ft\.?)\s*)/giu;

export function splitArtistNames(value = "") {
  return String(value ?? "")
    .split(artistSeparatorPattern)
    .map((item) => item.trim())
    .filter(Boolean);
}
