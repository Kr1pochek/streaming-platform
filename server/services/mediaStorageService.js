import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const mediaDirectory = path.resolve(currentDirectory, "../../public/audio");
const mediaRoutePrefix = "/api/media/";
const DEFAULT_CACHE_CONTROL = "public, max-age=31536000, immutable";

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

function normalizeRelativePath(relativePath) {
  return String(relativePath ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/");
}

function encodePathSegments(relativePath) {
  return normalizeRelativePath(relativePath)
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function ensureS3Configuration(env = process.env) {
  const bucket = String(env.MEDIA_S3_BUCKET ?? "").trim();
  if (!bucket) {
    throw new Error("MEDIA_S3_BUCKET is not configured.");
  }
  const region = String(env.MEDIA_S3_REGION ?? "us-east-1").trim();
  const endpoint = String(env.MEDIA_S3_ENDPOINT ?? "").trim();
  const accessKeyId = String(env.MEDIA_S3_ACCESS_KEY_ID ?? "").trim();
  const secretAccessKey = String(env.MEDIA_S3_SECRET_ACCESS_KEY ?? "").trim();

  const credentials =
    accessKeyId && secretAccessKey
      ? {
          accessKeyId,
          secretAccessKey,
        }
      : undefined;

  return {
    bucket,
    region,
    endpoint,
    credentials,
    forcePathStyle: parseBoolean(env.MEDIA_S3_FORCE_PATH_STYLE, true),
    acl: String(env.MEDIA_S3_ACL ?? "").trim(),
    prefix: normalizeRelativePath(env.MEDIA_S3_PREFIX ?? ""),
  };
}

let cachedS3Client = null;
let cachedS3ClientKey = "";

function s3ClientForEnvironment(env = process.env) {
  const config = ensureS3Configuration(env);
  const cacheKey = JSON.stringify({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    hasCredentials: Boolean(config.credentials),
  });

  if (cachedS3Client && cachedS3ClientKey === cacheKey) {
    return { client: cachedS3Client, config };
  }

  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint || undefined,
    forcePathStyle: config.forcePathStyle,
    credentials: config.credentials,
  });
  cachedS3Client = client;
  cachedS3ClientKey = cacheKey;
  return { client, config };
}

function localMediaPublicUrl(relativePath) {
  return `${mediaRoutePrefix}${encodePathSegments(relativePath)}`;
}

function s3ObjectKey(relativePath, env = process.env) {
  const normalizedPath = normalizeRelativePath(relativePath);
  const prefix = normalizeRelativePath(env.MEDIA_S3_PREFIX ?? "");
  if (!prefix) {
    return normalizedPath;
  }
  return `${prefix}/${normalizedPath}`;
}

function s3MediaPublicUrl(relativePath, env = process.env) {
  const key = s3ObjectKey(relativePath, env);
  const cdnBaseUrl = String(env.MEDIA_CDN_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (cdnBaseUrl) {
    return `${cdnBaseUrl}/${encodePathSegments(key)}`;
  }

  const publicBaseUrl = String(env.MEDIA_S3_PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (publicBaseUrl) {
    return `${publicBaseUrl}/${encodePathSegments(key)}`;
  }

  const { bucket, region, endpoint } = ensureS3Configuration(env);
  if (endpoint) {
    const normalizedEndpoint = endpoint.replace(/\/+$/, "");
    return `${normalizedEndpoint}/${encodeURIComponent(bucket)}/${encodePathSegments(key)}`;
  }
  return `https://${encodeURIComponent(bucket)}.s3.${region}.amazonaws.com/${encodePathSegments(key)}`;
}

export function mediaStorageDriver(env = process.env) {
  const configured = String(env.MEDIA_STORAGE_DRIVER ?? "local").trim().toLowerCase();
  return configured === "s3" ? "s3" : "local";
}

export function mediaPublicUrlForRelativePath(relativePath, env = process.env) {
  const normalizedPath = normalizeRelativePath(relativePath);
  if (!normalizedPath) {
    return "";
  }
  if (mediaStorageDriver(env) === "s3") {
    return s3MediaPublicUrl(normalizedPath, env);
  }
  return localMediaPublicUrl(normalizedPath);
}

export async function persistMediaFile({
  sourceFilePath,
  relativePath,
  contentType = "application/octet-stream",
  cacheControl = DEFAULT_CACHE_CONTROL,
  env = process.env,
} = {}) {
  const normalizedSourcePath = path.resolve(String(sourceFilePath ?? ""));
  const normalizedRelativePath = normalizeRelativePath(relativePath);

  if (!normalizedRelativePath) {
    throw new Error("Media relative path is required.");
  }
  if (!fs.existsSync(normalizedSourcePath) || !fs.statSync(normalizedSourcePath).isFile()) {
    throw new Error(`Media source file does not exist: ${normalizedSourcePath}`);
  }

  const driver = mediaStorageDriver(env);
  if (driver === "local") {
    const destinationPath = path.resolve(mediaDirectory, normalizedRelativePath);
    const mediaRoot = path.resolve(mediaDirectory);
    const isInsideMediaRoot =
      destinationPath === mediaRoot || destinationPath.startsWith(`${mediaRoot}${path.sep}`);
    if (!isInsideMediaRoot) {
      throw new Error("Resolved local media path escapes media root.");
    }
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(normalizedSourcePath, destinationPath);
    return {
      driver: "local",
      relativePath: normalizedRelativePath,
      publicUrl: localMediaPublicUrl(normalizedRelativePath),
      absolutePath: destinationPath,
    };
  }

  const { client, config } = s3ClientForEnvironment(env);
  const objectKey = s3ObjectKey(normalizedRelativePath, env);
  const objectBody = fs.readFileSync(normalizedSourcePath);
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: objectKey,
    Body: objectBody,
    ContentType: contentType,
    CacheControl: cacheControl,
    ...(config.acl ? { ACL: config.acl } : {}),
  });
  await client.send(command);

  return {
    driver: "s3",
    relativePath: normalizedRelativePath,
    objectKey,
    publicUrl: s3MediaPublicUrl(normalizedRelativePath, env),
  };
}

export function relativePathFromLocalMediaUrl(mediaUrl) {
  const normalizedUrl = String(mediaUrl ?? "").trim();
  if (!normalizedUrl.startsWith(mediaRoutePrefix)) {
    return "";
  }
  const relativePart = normalizedUrl.slice(mediaRoutePrefix.length);
  try {
    return normalizeRelativePath(decodeURIComponent(relativePart));
  } catch {
    return "";
  }
}
