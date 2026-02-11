import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  HttpError,
  createAutoArtistId,
  coverForPlaylist,
  hlsDirectory,
  invalidateCatalogCache,
  normalizeTitle,
  pool,
  splitArtistNames,
  withTransaction,
} from "./catalogService.js";
import { persistMediaFile } from "./mediaStorageService.js";

const uploadProcessingRoot = path.resolve(hlsDirectory, "../../tmp/upload-processing");
const DEFAULT_DURATION_SEC = 180;
const MIN_DURATION_SEC = 1;
const MAX_DURATION_SEC = 60 * 60 * 4;
const allowedAudioExtensions = new Set([".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac", ".opus"]);
const ffmpegBinaryPath = String(process.env.FFMPEG_PATH ?? "ffmpeg").trim() || "ffmpeg";
const ffprobeBinaryPath = String(process.env.FFPROBE_PATH ?? "ffprobe").trim() || "ffprobe";
const hlsAudioProfiles = [
  { name: "high", bitrateKbps: 192 },
  { name: "medium", bitrateKbps: 128 },
  { name: "low", bitrateKbps: 64 },
];

function toFfmpegPath(value) {
  return String(value ?? "").replace(/\\/g, "/");
}

function parseBoolean(value, fallback = false) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseDurationSec(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.min(Math.max(parsed, MIN_DURATION_SEC), MAX_DURATION_SEC);
}

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9а-яё]+/giu, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 56);
}

function normalizeTrackId(rawTrackId, title) {
  const directSlug = slugify(rawTrackId);
  if (directSlug) {
    return directSlug;
  }
  const titleSlug = slugify(title);
  if (titleSlug) {
    return titleSlug;
  }
  return `track-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function normalizeTags(rawTags) {
  if (Array.isArray(rawTags)) {
    return Array.from(new Set(rawTags.map((item) => normalizeTitle(item).toLowerCase()).filter(Boolean))).slice(0, 12);
  }

  const text = normalizeTitle(rawTags);
  if (!text) {
    return [];
  }
  return Array.from(
    new Set(
      text
        .split(/[,\n]+/g)
        .map((item) => normalizeTitle(item).toLowerCase())
        .filter(Boolean)
    )
  ).slice(0, 12);
}

function ffmpegResult(args) {
  return spawnSync(ffmpegBinaryPath, args, {
    encoding: "utf8",
    stdio: "pipe",
  });
}

function ffprobeResult(args) {
  return spawnSync(ffprobeBinaryPath, args, {
    encoding: "utf8",
    stdio: "pipe",
  });
}

function failWithFfmpegError(prefix, result) {
  if (result?.error) {
    throw new Error(`${prefix}: ${result.error.message}`);
  }
  const stderr = String(result?.stderr ?? "").trim();
  const firstLine = stderr.split(/\r?\n/).find(Boolean);
  throw new Error(`${prefix}: ${firstLine || `exit code ${result?.status ?? "unknown"}`}`);
}

function removeLegacySingleVariantArtifacts(outputDirectory) {
  if (!fs.existsSync(outputDirectory)) {
    return;
  }
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

function transcodeToMp3(inputFilePath, outputFilePath) {
  const result = ffmpegResult([
    "-y",
    "-i",
    inputFilePath,
    "-map",
    "0:a:0",
    "-vn",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "192k",
    outputFilePath,
  ]);

  if (result.status !== 0) {
    failWithFfmpegError("Audio transcoding failed", result);
  }
}

function probeDurationInSeconds(filePath) {
  const result = ffprobeResult([
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);

  if (result.status !== 0) {
    return null;
  }
  const parsed = Number.parseFloat(String(result.stdout ?? "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.round(parsed);
}

function shouldGenerateHlsOnUpload(env = process.env) {
  return parseBoolean(env.GENERATE_HLS_ON_UPLOAD, true);
}

function buildUploadCover(trackId, rawCover) {
  const normalizedCover = normalizeTitle(rawCover);
  if (normalizedCover) {
    return normalizedCover;
  }
  return coverForPlaylist(trackId);
}

function ensureAudioFileLooksSupported(filePath, originalName, mimetype) {
  const extension = path.extname(String(originalName ?? filePath)).toLowerCase();
  const isKnownExtension = allowedAudioExtensions.has(extension);
  const isAudioMimeType = String(mimetype ?? "").toLowerCase().startsWith("audio/");
  if (!isKnownExtension && !isAudioMimeType) {
    throw new HttpError(400, "Unsupported audio file type.");
  }
}

function generateLocalHlsFromAudio(trackId, inputAudioPath) {
  const outputDirectory = path.resolve(hlsDirectory, trackId);
  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.mkdirSync(outputDirectory, { recursive: true });

  const outputPattern = toFfmpegPath(path.resolve(outputDirectory, "%v", "index.m3u8"));
  const segmentPattern = toFfmpegPath(path.resolve(outputDirectory, "%v", "segment_%03d.ts"));
  const varStreamMap = hlsAudioProfiles.map((profile, index) => `a:${index},name:${profile.name}`).join(" ");
  const mapArgs = hlsAudioProfiles.flatMap(() => ["-map", "0:a:0"]);
  const bitrateArgs = hlsAudioProfiles.flatMap((profile, index) => [`-b:a:${index}`, `${profile.bitrateKbps}k`]);

  const result = ffmpegResult([
    "-y",
    "-i",
    inputAudioPath,
    ...mapArgs,
    "-c:a",
    "aac",
    ...bitrateArgs,
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
    varStreamMap,
    "-hls_segment_filename",
    segmentPattern,
    outputPattern,
  ]);

  if (result.status !== 0) {
    failWithFfmpegError("HLS generation failed", result);
  }
  removeLegacySingleVariantArtifacts(outputDirectory);
}

async function upsertTrackMetadata({
  trackId,
  title,
  artistLine,
  durationSec,
  explicit,
  cover,
  audioUrl,
  tags,
}) {
  await withTransaction(async (client) => {
    await client.query(
      `
      insert into tracks (id, title, duration_sec, explicit, cover, audio_url)
      values ($1, $2, $3, $4, $5, $6)
      on conflict (id) do update
        set title = excluded.title,
            duration_sec = excluded.duration_sec,
            explicit = excluded.explicit,
            cover = excluded.cover,
            audio_url = excluded.audio_url;
    `,
      [trackId, title, durationSec, explicit, cover, audioUrl]
    );

    const artistNames = splitArtistNames(artistLine);
    const artistIds = [];
    for (const artistName of artistNames) {
      const normalizedName = normalizeTitle(artistName);
      if (!normalizedName) {
        continue;
      }

      const { rows: foundRows } = await client.query(
        `
        select id
        from artists
        where lower(name) = lower($1)
        limit 1;
      `,
        [normalizedName]
      );

      let artistId = foundRows[0]?.id ?? null;
      if (!artistId) {
        artistId = createAutoArtistId();
        await client.query(
          `
          insert into artists (id, name, followers)
          values ($1, $2, '0')
          on conflict (name) do nothing;
        `,
          [artistId, normalizedName]
        );
        const { rows: refetchedRows } = await client.query(
          `
          select id
          from artists
          where lower(name) = lower($1)
          limit 1;
        `,
          [normalizedName]
        );
        artistId = refetchedRows[0]?.id ?? artistId;
      }
      if (!artistIds.includes(artistId)) {
        artistIds.push(artistId);
      }
    }

    await client.query("delete from track_artists where track_id = $1;", [trackId]);
    for (let index = 0; index < artistIds.length; index += 1) {
      await client.query(
        `
        insert into track_artists (track_id, artist_id, artist_order)
        values ($1, $2, $3)
        on conflict (track_id, artist_id) do update
          set artist_order = excluded.artist_order;
      `,
        [trackId, artistIds[index], index + 1]
      );
    }

    await client.query("delete from track_tags where track_id = $1;", [trackId]);
    for (const tag of tags) {
      await client.query(
        `
        insert into track_tags (track_id, tag)
        values ($1, $2)
        on conflict (track_id, tag) do nothing;
      `,
        [trackId, tag]
      );
    }
  });
}

export async function ingestUploadedTrack({
  uploadFilePath,
  originalFileName,
  mimetype,
  title,
  artist,
  durationSec,
  explicit,
  cover,
  tags,
  trackId,
  env = process.env,
} = {}) {
  const safeTitle = normalizeTitle(title);
  const safeArtist = normalizeTitle(artist);
  if (!safeTitle) {
    throw new HttpError(400, "Track title is required.");
  }
  if (!safeArtist) {
    throw new HttpError(400, "Track artist is required.");
  }

  const normalizedTrackId = normalizeTrackId(trackId, safeTitle);
  const safeCover = buildUploadCover(normalizedTrackId, cover);
  const safeTags = normalizeTags(tags);
  const explicitFlag = parseBoolean(explicit, false);
  const requestedDurationSec = parseDurationSec(durationSec);

  fs.mkdirSync(uploadProcessingRoot, { recursive: true });
  const workDirectory = fs.mkdtempSync(path.join(uploadProcessingRoot, `${normalizedTrackId}-`));
  const transcodedAudioPath = path.resolve(workDirectory, `${normalizedTrackId}.mp3`);

  let hlsGenerated = false;

  try {
    ensureAudioFileLooksSupported(uploadFilePath, originalFileName, mimetype);
    transcodeToMp3(uploadFilePath, transcodedAudioPath);

    const persisted = await persistMediaFile({
      sourceFilePath: transcodedAudioPath,
      relativePath: `tracks/${normalizedTrackId}.mp3`,
      contentType: "audio/mpeg",
      env,
    });

    if (shouldGenerateHlsOnUpload(env)) {
      try {
        generateLocalHlsFromAudio(normalizedTrackId, transcodedAudioPath);
        hlsGenerated = true;
      } catch (error) {
        console.warn(`[upload] HLS generation skipped for "${normalizedTrackId}": ${error.message}`);
      }
    }

    const finalDurationSec = requestedDurationSec ?? probeDurationInSeconds(transcodedAudioPath) ?? DEFAULT_DURATION_SEC;
    await upsertTrackMetadata({
      trackId: normalizedTrackId,
      title: safeTitle,
      artistLine: safeArtist,
      durationSec: finalDurationSec,
      explicit: explicitFlag,
      cover: safeCover,
      audioUrl: persisted.publicUrl,
      tags: safeTags,
    });
    invalidateCatalogCache();

    const { rows } = await pool.query(
      `
      select id, audio_url as "audioUrl"
      from tracks
      where id = $1
      limit 1;
    `,
      [normalizedTrackId]
    );

    return {
      id: normalizedTrackId,
      audioUrl: rows[0]?.audioUrl ?? persisted.publicUrl,
      durationSec: finalDurationSec,
      hlsGenerated,
    };
  } finally {
    fs.rmSync(workDirectory, { recursive: true, force: true });
  }
}
