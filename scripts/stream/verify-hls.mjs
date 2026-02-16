import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { tracks } from "../../shared/musicData.js";

function printUsage() {
  console.log("Usage:");
  console.log("  npm run stream:verify");
  console.log("  npm run stream:verify -- --track city-rain");
}

function parseArgs(argv) {
  const args = {
    trackIds: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--track" || token === "-t") {
      const value = String(argv[index + 1] ?? "").trim();
      if (value) {
        args.trackIds.push(value);
      }
      index += 1;
      continue;
    }
    if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    }
  }

  return args;
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function parseMasterPlaylist(masterContent) {
  const variants = [];
  const lines = masterContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith("#EXT-X-STREAM-INF:")) {
      continue;
    }
    const nextLine = lines[index + 1] ?? "";
    if (!nextLine || nextLine.startsWith("#")) {
      continue;
    }
    variants.push({
      info: line,
      playlist: nextLine,
    });
  }

  return variants;
}

function hasLegacyArtifacts(trackDirectory) {
  if (!fs.existsSync(trackDirectory)) {
    return false;
  }
  const entries = fs.readdirSync(trackDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const fileName = entry.name.toLowerCase();
    if (fileName === "index.m3u8" || fileName.startsWith("segment_")) {
      return true;
    }
  }
  return false;
}

function validateVariantPlaylist(trackDirectory, variantPath) {
  const normalizedVariantPath = variantPath.replace(/\\/g, "/").replace(/^[/]+/, "");
  const variantAbsolutePath = path.resolve(trackDirectory, normalizedVariantPath);
  if (!variantAbsolutePath.startsWith(`${path.resolve(trackDirectory)}${path.sep}`)) {
    return { ok: false, reason: `variant path escapes track directory: ${variantPath}` };
  }

  if (!fs.existsSync(variantAbsolutePath)) {
    return { ok: false, reason: `missing variant playlist: ${variantPath}` };
  }

  const variantContent = readUtf8(variantAbsolutePath);
  const hasExtInf = variantContent.includes("#EXTINF:");
  const hasSegmentReference = variantContent
    .split(/\r?\n/)
    .some((line) => {
      const normalized = line.trim();
      return Boolean(normalized) && !normalized.startsWith("#") && /\.ts(\?|$)/i.test(normalized);
    });

  if (!hasExtInf || !hasSegmentReference) {
    return { ok: false, reason: `variant playlist has no media segments: ${variantPath}` };
  }

  return { ok: true };
}

function validateTrack(trackId, outputRoot) {
  const trackDirectory = path.resolve(outputRoot, trackId);
  const masterPath = path.resolve(trackDirectory, "master.m3u8");
  if (!fs.existsSync(masterPath)) {
    return { ok: false, reason: "missing master.m3u8" };
  }

  if (hasLegacyArtifacts(trackDirectory)) {
    return { ok: false, reason: "legacy root artifacts found (index.m3u8/segment_*)" };
  }

  const masterContent = readUtf8(masterPath);
  const variants = parseMasterPlaylist(masterContent);
  if (variants.length < 2) {
    return { ok: false, reason: `not enough variants in master.m3u8: ${variants.length}` };
  }

  for (const variant of variants) {
    const variantValidation = validateVariantPlaylist(trackDirectory, variant.playlist);
    if (!variantValidation.ok) {
      return variantValidation;
    }
  }

  return { ok: true, variantCount: variants.length };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDirectory = process.cwd();
  const outputRoot = path.resolve(rootDirectory, "public/audio/hls");

  const selectedTrackIdSet = new Set(args.trackIds);
  const selectedTracks = selectedTrackIdSet.size
    ? tracks.filter((track) => selectedTrackIdSet.has(track.id))
    : tracks;

  if (!selectedTracks.length) {
    console.error("No tracks selected.");
    process.exit(1);
  }

  if (!fs.existsSync(outputRoot)) {
    console.error("HLS directory does not exist.");
    process.exit(1);
  }

  const failures = [];
  const verified = [];
  for (const track of selectedTracks) {
    const validation = validateTrack(track.id, outputRoot);
    if (!validation.ok) {
      failures.push({ id: track.id, reason: validation.reason ?? "unknown error" });
      continue;
    }
    verified.push({ id: track.id, variantCount: validation.variantCount ?? 0 });
  }

  console.log(`tracks checked: ${selectedTracks.length}`);
  console.log(`tracks verified: ${verified.length}`);
  if (verified.length) {
    const minVariants = verified.reduce(
      (minimum, item) => (item.variantCount < minimum ? item.variantCount : minimum),
      verified[0].variantCount
    );
    console.log(`minimum variants per track: ${minVariants}`);
  }
  if (failures.length) {
    console.log("verification failures:");
    for (const failure of failures) {
      console.log(`  - ${failure.id}: ${failure.reason}`);
    }
    process.exitCode = 2;
    return;
  }

  console.log("ABR verification passed.");
}

main();
