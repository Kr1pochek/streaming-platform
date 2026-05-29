import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  HttpError,
  createAutoArtistId,
  createReleaseId,
  coverForPlaylist,
  hlsDirectory,
  hlsManifestUrlForTrack,
  hasHlsManifestForTrack,
  invalidateCatalogCache,
  normalizeTitle,
  pool,
  sanitizeTrackTags,
  splitArtistNames,
  withTransaction,
} from "./catalogService.js";
import { persistMediaFile } from "./mediaStorageService.js";

const uploadProcessingRoot = path.resolve(hlsDirectory, "../../tmp/upload-processing");
const DEFAULT_DURATION_SEC = 180;
const MIN_DURATION_SEC = 1;
const MAX_DURATION_SEC = 60 * 60 * 4;
const allowedAudioExtensions = new Set([".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac", ".opus"]);
const audioContentTypeByExtension = new Map([
  [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"],
  [".ogg", "audio/ogg"],
  [".m4a", "audio/mp4"],
  [".flac", "audio/flac"],
  [".aac", "audio/aac"],
  [".opus", "audio/ogg"],
]);
const ffmpegBinaryPath = String(process.env.FFMPEG_PATH ?? "ffmpeg").trim() || "ffmpeg";
const ffprobeBinaryPath = String(process.env.FFPROBE_PATH ?? "ffprobe").trim() || "ffprobe";
const hlsAudioProfiles = [
  { name: "high", bitrateKbps: 192 },
  { name: "medium", bitrateKbps: 128 },
  { name: "low", bitrateKbps: 64 },
];
const RELEASE_TYPES = new Set(["single", "ep", "album"]);
const MAX_RELEASE_UPLOAD_TRACKS = 40;
const UPLOAD_PENDING_REASON = "Awaiting moderation";

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

function parseYear(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  const currentYear = new Date().getFullYear();
  if (!Number.isFinite(parsed)) {
    return currentYear;
  }
  return Math.min(Math.max(parsed, 1900), currentYear + 2);
}

function normalizeReleaseType(value, trackCount) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (RELEASE_TYPES.has(normalized)) {
    return normalized;
  }
  return trackCount === 1 ? "single" : trackCount >= 7 ? "album" : "ep";
}

function assertReleaseUploadTrackCount(type, trackCount) {
  if (trackCount <= 0) {
    throw new HttpError(400, "At least one audio file is required.");
  }
  if (trackCount > MAX_RELEASE_UPLOAD_TRACKS) {
    throw new HttpError(400, `Upload up to ${MAX_RELEASE_UPLOAD_TRACKS} tracks in one release.`);
  }
  if (type === "single" && trackCount !== 1) {
    throw new HttpError(400, "Single must contain exactly one track.");
  }
  if ((type === "ep" || type === "album") && trackCount < 2) {
    throw new HttpError(400, "EP and album must contain at least two tracks.");
  }
}

function parseReleaseTracksPayload(value) {
  if (Array.isArray(value)) {
    return value;
  }

  const text = String(value ?? "").trim();
  if (!text) {
    return [];
  }

  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new HttpError(400, "Track metadata must be valid JSON.");
  }
}

function normalizeTrackPayload(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function inferTitleFromUploadName(fileName) {
  return normalizeTitle(
    path
      .basename(String(fileName ?? ""))
      .replace(/\.[^.]+$/, "")
      .replace(/[_]+/g, " ")
  );
}

function combineUploadTags({ genre, sharedTags, trackTags }) {
  return [genre, sharedTags, trackTags]
    .map((value) => {
      if (Array.isArray(value)) {
        return value.join(",");
      }
      return String(value ?? "");
    })
    .filter((value) => value.trim())
    .join(",");
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
    return sanitizeTrackTags(rawTags.map((item) => normalizeTitle(item).toLowerCase())).slice(0, 12);
  }

  const text = normalizeTitle(rawTags);
  if (!text) {
    return [];
  }
  return sanitizeTrackTags(
    text
      .split(/[,\n]+/g)
      .map((item) => normalizeTitle(item).toLowerCase())
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

function resolveUploadAudioExtension(filePath, originalName, mimetype) {
  const extensionFromName = path.extname(String(originalName ?? filePath)).toLowerCase();
  if (allowedAudioExtensions.has(extensionFromName)) {
    return extensionFromName;
  }

  const normalizedMime = String(mimetype ?? "").trim().toLowerCase();
  for (const [extension, contentType] of audioContentTypeByExtension.entries()) {
    if (contentType === normalizedMime) {
      return extension;
    }
  }

  if (normalizedMime === "audio/opus") {
    return ".opus";
  }
  if (normalizedMime === "audio/x-m4a") {
    return ".m4a";
  }

  return ".mp3";
}

function resolveAudioContentType(extension, mimetype = "") {
  const normalizedExtension = String(extension ?? "").trim().toLowerCase();
  if (audioContentTypeByExtension.has(normalizedExtension)) {
    return audioContentTypeByExtension.get(normalizedExtension);
  }

  const normalizedMime = String(mimetype ?? "").trim().toLowerCase();
  if (normalizedMime.startsWith("audio/")) {
    return normalizedMime;
  }

  return "application/octet-stream";
}

function shouldFallbackToOriginalAudio(error) {
  const message = String(error?.message ?? "").toLowerCase();
  return message.includes("spawnsync ffmpeg eperm") || message.includes("spawnsync ffmpeg enoent");
}

function copyAudioSource(inputFilePath, outputFilePath) {
  fs.copyFileSync(inputFilePath, outputFilePath);
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
  uploaderUserId,
  moderationReason = UPLOAD_PENDING_REASON,
}) {
  const createdAt = Date.now();

  await withTransaction(async (client) => {
    await client.query(
      `
      insert into tracks (
        id,
        title,
        duration_sec,
        explicit,
        cover,
        audio_url,
        created_at,
        uploaded_by,
        is_hidden,
        hidden_reason,
        hidden_by,
        hidden_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, null, $10)
      on conflict (id) do update
        set title = excluded.title,
            duration_sec = excluded.duration_sec,
            explicit = excluded.explicit,
            cover = excluded.cover,
            audio_url = excluded.audio_url,
            created_at = coalesce(tracks.created_at, excluded.created_at),
            uploaded_by = coalesce(tracks.uploaded_by, excluded.uploaded_by),
            is_hidden = true,
            hidden_reason = excluded.hidden_reason,
            hidden_by = null,
            hidden_at = excluded.hidden_at;
    `,
      [trackId, title, durationSec, explicit, cover, audioUrl, createdAt, uploaderUserId ?? null, moderationReason, createdAt]
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
  uploaderUserId,
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
  const originalExtension = resolveUploadAudioExtension(uploadFilePath, originalFileName, mimetype);
  const originalContentType = resolveAudioContentType(originalExtension, mimetype);

  fs.mkdirSync(uploadProcessingRoot, { recursive: true });
  const workDirectory = fs.mkdtempSync(path.join(uploadProcessingRoot, `${normalizedTrackId}-`));
  const transcodedAudioPath = path.resolve(workDirectory, `${normalizedTrackId}.mp3`);
  const originalAudioPath = path.resolve(workDirectory, `${normalizedTrackId}${originalExtension}`);

  let hlsGenerated = false;
  let persistedSourcePath = transcodedAudioPath;
  let persistedRelativePath = `tracks/${normalizedTrackId}.mp3`;
  let persistedContentType = "audio/mpeg";

  try {
    ensureAudioFileLooksSupported(uploadFilePath, originalFileName, mimetype);
    try {
      transcodeToMp3(uploadFilePath, transcodedAudioPath);
    } catch (error) {
      if (!shouldFallbackToOriginalAudio(error)) {
        throw error;
      }

      copyAudioSource(uploadFilePath, originalAudioPath);
      persistedSourcePath = originalAudioPath;
      persistedRelativePath = `tracks/${normalizedTrackId}${originalExtension}`;
      persistedContentType = originalContentType;
      console.warn(
        `[upload] ffmpeg is unavailable for "${normalizedTrackId}", storing original audio as ${originalExtension}.`
      );
    }

    const persisted = await persistMediaFile({
      sourceFilePath: persistedSourcePath,
      relativePath: persistedRelativePath,
      contentType: persistedContentType,
      env,
    });

    if (shouldGenerateHlsOnUpload(env)) {
      try {
        generateLocalHlsFromAudio(normalizedTrackId, persistedSourcePath);
        hlsGenerated = true;
      } catch (error) {
        console.warn(`[upload] HLS generation skipped for "${normalizedTrackId}": ${error.message}`);
      }
    }

    const finalDurationSec = requestedDurationSec ?? probeDurationInSeconds(persistedSourcePath) ?? DEFAULT_DURATION_SEC;
    await upsertTrackMetadata({
      trackId: normalizedTrackId,
      title: safeTitle,
      artistLine: safeArtist,
      durationSec: finalDurationSec,
      explicit: explicitFlag,
      cover: safeCover,
      audioUrl: persisted.publicUrl,
      tags: safeTags,
      uploaderUserId,
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

    const hasHls = hasHlsManifestForTrack(normalizedTrackId);

    return {
      id: normalizedTrackId,
      title: safeTitle,
      artist: safeArtist,
      audioUrl: rows[0]?.audioUrl ?? persisted.publicUrl,
      rawAudioUrl: rows[0]?.audioUrl ?? persisted.publicUrl,
      hlsUrl: hasHls ? hlsManifestUrlForTrack(normalizedTrackId) : null,
      hasHls,
      durationSec: finalDurationSec,
      explicit: explicitFlag,
      cover: safeCover,
      tags: safeTags,
      isHidden: true,
      moderationStatus: "pending",
      hlsGenerated,
    };
  } finally {
    fs.rmSync(workDirectory, { recursive: true, force: true });
  }
}

async function resolveUploadedReleaseDefaults(client, trackIds) {
  const { rows } = await client.query(
    `
    select
      t.id,
      t.title,
      t.cover,
      primary_artist.artist_id as "artistId"
    from tracks t
    left join lateral (
      select ta.artist_id
      from track_artists ta
      where ta.track_id = t.id
      order by ta.artist_order asc
      limit 1
    ) primary_artist on true
    where t.id = any($1::text[]);
    `,
    [trackIds]
  );

  const rowById = new Map(rows.map((row) => [row.id, row]));
  const orderedRows = trackIds.map((trackId) => rowById.get(trackId)).filter(Boolean);
  if (orderedRows.length !== trackIds.length) {
    throw new HttpError(500, "Uploaded tracks are not available for release creation.");
  }

  const firstTrack = orderedRows[0];
  if (!firstTrack?.artistId) {
    throw new HttpError(500, "Uploaded tracks are missing artist metadata.");
  }

  return {
    artistId: firstTrack.artistId,
    firstTrack,
    orderedRows,
  };
}

export async function createPendingUploadedRelease({
  releaseTitle,
  releaseType,
  year,
  cover,
  description,
  trackIds,
  actorUserId,
}) {
  return withTransaction(async (client) => {
    const { artistId, firstTrack } = await resolveUploadedReleaseDefaults(client, trackIds);
    const releaseId = createReleaseId();
    const createdAt = Date.now();
    const safeTitle = normalizeTitle(releaseTitle) || firstTrack.title;
    const safeCover = normalizeTitle(cover) || firstTrack.cover || coverForPlaylist(releaseId);
    const safeYear = parseYear(year);

    if (!safeTitle) {
      throw new HttpError(400, "Release title is required.");
    }
    if (!safeCover) {
      throw new HttpError(400, "Release cover is required.");
    }

    await client.query(
      `
      insert into releases (
        id,
        artist_id,
        title,
        type,
        year,
        cover,
        description,
        status,
        created_at,
        published_at,
        created_by
      )
      values ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, null, $9);
      `,
      [
        releaseId,
        artistId,
        safeTitle,
        releaseType,
        safeYear,
        safeCover,
        normalizeTitle(description) || null,
        createdAt,
        String(actorUserId ?? "").trim() || null,
      ]
    );

    for (let index = 0; index < trackIds.length; index += 1) {
      await client.query(
        `
        insert into release_tracks (release_id, track_id, position)
        values ($1, $2, $3);
        `,
        [releaseId, trackIds[index], index + 1]
      );
    }

    return {
      id: releaseId,
      artistId,
      title: safeTitle,
      type: releaseType,
      year: safeYear,
      cover: safeCover,
      status: "pending",
      isPublished: false,
      isPending: true,
      createdAt,
      publishedAt: 0,
      trackIds,
    };
  });
}

export async function ingestUploadedRelease({
  files,
  releaseTitle,
  releaseType,
  year,
  artist,
  genre,
  cover,
  description,
  tags,
  explicit,
  tracks,
  uploaderUserId,
  env = process.env,
} = {}) {
  const uploadFiles = (Array.isArray(files) ? files : [])
    .map((file) => ({
      uploadFilePath: file?.uploadFilePath,
      originalFileName: file?.originalFileName,
      mimetype: file?.mimetype,
    }))
    .filter((file) => file.uploadFilePath);
  const type = normalizeReleaseType(releaseType, uploadFiles.length);
  assertReleaseUploadTrackCount(type, uploadFiles.length);

  const safeArtist = normalizeTitle(artist);
  if (!safeArtist) {
    throw new HttpError(400, "Release artist is required.");
  }

  const trackPayloads = parseReleaseTracksPayload(tracks).map(normalizeTrackPayload);
  const sharedGenre = normalizeTitle(genre).toLowerCase();
  const sharedTags = tags;
  const sharedExplicit = parseBoolean(explicit, false);
  const uploadedTracks = [];

  for (let index = 0; index < uploadFiles.length; index += 1) {
    const file = uploadFiles[index];
    const trackPayload = trackPayloads[index] ?? {};
    const title = normalizeTitle(trackPayload.title) || inferTitleFromUploadName(file.originalFileName);
    if (!title) {
      throw new HttpError(400, `Track ${index + 1} title is required.`);
    }

    const uploadResult = await ingestUploadedTrack({
      uploadFilePath: file.uploadFilePath,
      originalFileName: file.originalFileName,
      mimetype: file.mimetype,
      trackId: trackPayload.trackId,
      title,
      artist: normalizeTitle(trackPayload.artist) || safeArtist,
      durationSec: trackPayload.durationSec,
      explicit: trackPayload.explicit ?? sharedExplicit,
      cover: normalizeTitle(trackPayload.cover) || cover,
      tags: combineUploadTags({
        genre: trackPayload.genre || sharedGenre,
        sharedTags,
        trackTags: trackPayload.tags,
      }),
      uploaderUserId,
      env,
    });

    uploadedTracks.push({
      ...uploadResult,
      title,
    });
  }

  const trackIds = uploadedTracks.map((track) => track.id);
  const release = await createPendingUploadedRelease({
    releaseTitle: normalizeTitle(releaseTitle) || uploadedTracks[0]?.title,
    releaseType: type,
    year: parseYear(year),
    cover,
    description,
    trackIds,
    actorUserId: uploaderUserId,
  });
  invalidateCatalogCache();

  return {
    release,
    tracks: uploadedTracks,
    trackIds,
    hlsGenerated: uploadedTracks.some((track) => track.hlsGenerated),
  };
}
