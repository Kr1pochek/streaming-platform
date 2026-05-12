import fs from "node:fs";
import path from "node:path";
import process from "node:process";

try {
  process.loadEnvFile?.(".env");
} catch {
  // Optional local configuration; CI and shell-provided env vars still work.
}

function printUsage() {
  console.log("Usage:");
  console.log("  npm run stream:verify");
  console.log("  npm run stream:verify -- --track your-track-id");
  console.log("  npm run stream:verify -- --all-hls");
}

function parseArgs(argv) {
  const args = {
    allHls: false,
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
    if (token === "--all-hls") {
      args.allHls = true;
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

function isDirectory(value) {
  try {
    return fs.statSync(value).isDirectory();
  } catch {
    return false;
  }
}

function listHlsTrackIds(outputRoot) {
  if (!fs.existsSync(outputRoot)) {
    return [];
  }

  return fs
    .readdirSync(outputRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((trackId) => {
      const masterPath = path.resolve(outputRoot, trackId, "master.m3u8");
      return fs.existsSync(masterPath) && parseMasterPlaylist(readUtf8(masterPath)).length > 0;
    })
    .sort((left, right) => left.localeCompare(right, "ru"));
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
  const segmentReferences = variantContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#") && /\.ts(\?|$)/i.test(line));
  const hasSegmentReference = segmentReferences.length > 0;

  const variantDirectory = path.dirname(variantAbsolutePath);
  const missingSegments = segmentReferences
    .map((segmentPath) => segmentPath.split("?", 1)[0])
    .filter((segmentPath) => {
      const segmentAbsolutePath = path.resolve(variantDirectory, segmentPath.replace(/\\/g, "/"));
      const normalizedVariantDirectory = path.resolve(variantDirectory);
      const isInsideVariantDirectory =
        segmentAbsolutePath === normalizedVariantDirectory ||
        segmentAbsolutePath.startsWith(`${normalizedVariantDirectory}${path.sep}`);
      return !isInsideVariantDirectory || !fs.existsSync(segmentAbsolutePath);
    });

  if (missingSegments.length) {
    return {
      ok: false,
      reason: `missing media segment(s) in ${variantPath}: ${missingSegments.slice(0, 3).join(", ")}`,
    };
  }

  const segmentCount = segmentReferences.length;
  const durationCount = variantContent
    .split(/\r?\n/)
    .some((line) => {
      const normalized = line.trim();
      return normalized.startsWith("#EXTINF:");
    });

  if (!hasExtInf || !hasSegmentReference || !durationCount) {
    return { ok: false, reason: `variant playlist has no media segments: ${variantPath}` };
  }

  return { ok: true, segmentCount };
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

  let totalSegments = 0;
  for (const variant of variants) {
    const variantValidation = validateVariantPlaylist(trackDirectory, variant.playlist);
    if (!variantValidation.ok) {
      return variantValidation;
    }
    totalSegments += variantValidation.segmentCount ?? 0;
  }

  return { ok: true, variantCount: variants.length, totalSegments };
}

async function loadCatalogTrackIds() {
  let closePool = null;
  try {
    const catalogService = await import("../../server/services/catalogService.js");
    closePool = catalogService.closePool;
    const catalog = await catalogService.fetchCatalog();
    const trackIds = Array.isArray(catalog?.tracks)
      ? catalog.tracks.map((track) => String(track?.id ?? "").trim()).filter(Boolean)
      : [];
    return { ok: true, trackIds, source: "database catalog" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { ok: false, trackIds: [], reason: message };
  } finally {
    if (typeof closePool === "function") {
      await closePool().catch(() => {});
    }
  }
}

async function resolveSelectedTrackIds(args, outputRoot) {
  const explicitTrackIds = Array.from(new Set(args.trackIds));
  if (explicitTrackIds.length) {
    return {
      source: "explicit --track",
      trackIds: explicitTrackIds,
      warning: "",
    };
  }

  if (args.allHls) {
    return {
      source: "HLS directory scan",
      trackIds: listHlsTrackIds(outputRoot),
      warning: "",
    };
  }

  const catalogSelection = await loadCatalogTrackIds();
  if (catalogSelection.ok && catalogSelection.trackIds.length) {
    return {
      source: catalogSelection.source,
      trackIds: catalogSelection.trackIds,
      warning: "",
    };
  }

  const fallbackTrackIds = listHlsTrackIds(outputRoot);
  return {
    source: "HLS directory scan",
    trackIds: fallbackTrackIds,
    warning: catalogSelection.ok
      ? "Database catalog returned no tracks; falling back to HLS directories."
      : `Database catalog unavailable (${catalogSelection.reason}); falling back to HLS directories.`,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDirectory = process.cwd();
  const outputRoot = path.resolve(rootDirectory, "public/audio/hls");

  if (!fs.existsSync(outputRoot)) {
    console.error("HLS directory does not exist.");
    process.exit(1);
  }

  if (!isDirectory(outputRoot)) {
    console.error("HLS path exists but is not a directory.");
    process.exit(1);
  }

  const selection = await resolveSelectedTrackIds(args, outputRoot);
  const selectedTrackIds = selection.trackIds;
  if (selection.warning) {
    console.warn(selection.warning);
  }

  if (!selectedTrackIds.length) {
    console.error("No tracks selected.");
    process.exit(1);
  }

  const failures = [];
  const verified = [];
  for (const trackId of selectedTrackIds) {
    const validation = validateTrack(trackId, outputRoot);
    if (!validation.ok) {
      failures.push({ id: trackId, reason: validation.reason ?? "unknown error" });
      continue;
    }
    verified.push({
      id: trackId,
      variantCount: validation.variantCount ?? 0,
      totalSegments: validation.totalSegments ?? 0,
    });
  }

  console.log(`source: ${selection.source}`);
  console.log(`tracks checked: ${selectedTrackIds.length}`);
  console.log(`tracks verified: ${verified.length}`);
  if (verified.length) {
    const minVariants = verified.reduce(
      (minimum, item) => (item.variantCount < minimum ? item.variantCount : minimum),
      verified[0].variantCount
    );
    const totalSegments = verified.reduce((sum, item) => sum + item.totalSegments, 0);
    console.log(`minimum variants per track: ${minVariants}`);
    console.log(`media segments verified: ${totalSegments}`);
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
