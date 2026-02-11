import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { tracks } from "../../shared/musicData.js";

const ALLOWED_EXTENSIONS = [".mp3", ".wav", ".ogg", ".m4a", ".flac"];
const ffmpegBinaryPath = String(process.env.FFMPEG_PATH ?? "ffmpeg").trim() || "ffmpeg";
const HLS_AUDIO_PROFILES = [
  { name: "high", bitrateKbps: 192 },
  { name: "medium", bitrateKbps: 128 },
  { name: "low", bitrateKbps: 64 },
];

function toFfmpegPath(value) {
  return String(value ?? "").replace(/\\/g, "/");
}

function printUsage() {
  console.log("Usage:");
  console.log("  npm run stream:hls");
  console.log("  npm run stream:hls -- --track city-rain");
  console.log("  npm run stream:hls -- --track city-rain --track poison-halo --dry-run");
}

function parseArgs(argv) {
  const args = {
    trackIds: [],
    dryRun: false,
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
    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    }
  }

  return args;
}

function resolveInputFile(rootDirectory, track) {
  const rawUrl = String(track?.audioUrl ?? "").trim();
  const fileNameFromUrl = rawUrl.startsWith("/api/media/")
    ? rawUrl.slice("/api/media/".length).replace(/^[/\\]+/, "")
    : "";
  if (fileNameFromUrl) {
    const absolutePath = path.resolve(rootDirectory, "public/audio", fileNameFromUrl);
    if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
      return absolutePath;
    }
  }

  const trackId = String(track?.id ?? "").trim();
  if (!trackId) {
    return null;
  }
  for (const extension of ALLOWED_EXTENSIONS) {
    const candidate = path.resolve(rootDirectory, "public/audio/tracks", `${trackId}${extension}`);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

function runFfmpeg(inputFilePath, outputDirectory) {
  const outputPattern = toFfmpegPath(path.resolve(outputDirectory, "%v", "index.m3u8"));
  const segmentPattern = toFfmpegPath(path.resolve(outputDirectory, "%v", "segment_%03d.ts"));
  const profileMapArgs = HLS_AUDIO_PROFILES.map((profile, index) => `a:${index},name:${profile.name}`).join(" ");
  const profileBitrateArgs = HLS_AUDIO_PROFILES.flatMap((profile, index) => [
    `-b:a:${index}`,
    `${profile.bitrateKbps}k`,
  ]);
  const mapArgs = HLS_AUDIO_PROFILES.flatMap(() => ["-map", "0:a:0"]);

  const args = [
    "-y",
    "-i",
    inputFilePath,
    ...mapArgs,
    "-c:a",
    "aac",
    ...profileBitrateArgs,
    "-ac",
    "2",
    "-ar",
    "44100",
    "-f",
    "hls",
    "-hls_time",
    "6",
    "-hls_playlist_type",
    "vod",
    "-hls_flags",
    "independent_segments",
    "-master_pl_name",
    "master.m3u8",
    "-var_stream_map",
    profileMapArgs,
    "-hls_segment_filename",
    segmentPattern,
    outputPattern,
  ];

  return spawnSync(ffmpegBinaryPath, args, {
    stdio: "pipe",
    encoding: "utf8",
    shell: false,
  });
}

function removeLegacySingleVariantArtifacts(outputDirectory) {
  const entries = fs.readdirSync(outputDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const fileName = entry.name.toLowerCase();
    if (fileName === "master.m3u8") {
      continue;
    }
    if (fileName === "index.m3u8" || fileName.startsWith("segment_")) {
      fs.rmSync(path.resolve(outputDirectory, entry.name), { force: true });
    }
  }
}

function removeLegacyArtifactsInAllTrackDirectories(outputRoot) {
  if (!fs.existsSync(outputRoot)) {
    return;
  }
  const trackDirectories = fs.readdirSync(outputRoot, { withFileTypes: true });
  for (const entry of trackDirectories) {
    if (!entry.isDirectory()) {
      continue;
    }
    removeLegacySingleVariantArtifacts(path.resolve(outputRoot, entry.name));
  }
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

  if (!args.dryRun) {
    fs.mkdirSync(outputRoot, { recursive: true });
  }

  const missing = [];
  const failed = [];
  let ffmpegUnavailable = false;
  let generated = 0;

  for (const track of selectedTracks) {
    const inputFilePath = resolveInputFile(rootDirectory, track);
    if (!inputFilePath) {
      missing.push(track.id);
      continue;
    }

    const trackOutputDirectory = path.resolve(outputRoot, track.id);
    if (args.dryRun) {
      console.log(`[dry-run] ${track.id}: ${inputFilePath} -> ${trackOutputDirectory}`);
      generated += 1;
      continue;
    }

    fs.rmSync(trackOutputDirectory, { recursive: true, force: true });
    fs.mkdirSync(trackOutputDirectory, { recursive: true });
    const result = runFfmpeg(inputFilePath, trackOutputDirectory);
    if (result.error || result.status !== 0) {
      if (result.error?.code === "ENOENT") {
        ffmpegUnavailable = true;
      }
      const stderr = String(result.stderr ?? "").trim();
      const firstErrorLine = stderr.split(/\r?\n/).find(Boolean);
      failed.push({
        id: track.id,
        reason: result.error?.message ?? firstErrorLine ?? `exit code ${result.status ?? "unknown"}`,
      });
      if (ffmpegUnavailable) {
        break;
      }
      continue;
    }
    removeLegacySingleVariantArtifacts(trackOutputDirectory);
    generated += 1;
  }

  console.log(`tracks selected: ${selectedTracks.length}`);
  console.log(`hls generated: ${generated}${args.dryRun ? " (dry-run)" : ""}`);
  if (missing.length) {
    console.log(`missing source files: ${missing.join(", ")}`);
  }
  if (failed.length) {
    console.log("failed conversions:");
    for (const failure of failed) {
      console.log(`  - ${failure.id}: ${failure.reason}`);
    }
  }
  if (ffmpegUnavailable) {
    console.log("ffmpeg was not found in PATH.");
  }

  if (!args.dryRun) {
    removeLegacyArtifactsInAllTrackDirectories(outputRoot);
  }

  if (missing.length || failed.length) {
    process.exitCode = 2;
  }
}

main();
