import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { setUserAvatarUrl } from "./authService.js";
import { HttpError, mediaDirectory, pool, resolveMediaFilePath } from "./catalogService.js";
import { persistMediaFile, relativePathFromLocalMediaUrl } from "./mediaStorageService.js";

const avatarContentTypeByExtension = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
]);
const avatarDirectoryRoot = path.resolve(mediaDirectory, "avatars");

function resolveAvatarExtension(filePath, originalName, mimetype) {
  const extensionFromName = path.extname(String(originalName ?? filePath)).toLowerCase();
  if (avatarContentTypeByExtension.has(extensionFromName)) {
    return extensionFromName;
  }

  const normalizedMime = String(mimetype ?? "").trim().toLowerCase();
  for (const [extension, contentType] of avatarContentTypeByExtension.entries()) {
    if (contentType === normalizedMime) {
      return extension;
    }
  }

  return "";
}

function ensureAvatarFileLooksSupported(filePath, originalName, mimetype) {
  const extension = resolveAvatarExtension(filePath, originalName, mimetype);
  const normalizedMime = String(mimetype ?? "").trim().toLowerCase();
  const looksLikeRasterImage = normalizedMime.startsWith("image/") && normalizedMime !== "image/svg+xml";

  if (!extension || !looksLikeRasterImage) {
    throw new HttpError(400, "Avatar must be a JPG, PNG, WebP, or GIF image.");
  }

  return extension;
}

async function getCurrentAvatarUrl(userId) {
  const normalizedUserId = String(userId ?? "").trim();
  if (!normalizedUserId) {
    throw new HttpError(401, "User is not authenticated.");
  }

  const { rows } = await pool.query(
    `
    select avatar_url as "avatarUrl"
    from users
    where id = $1
    limit 1;
  `,
    [normalizedUserId]
  );

  if (!rows[0]) {
    throw new HttpError(404, "User not found.");
  }

  return String(rows[0].avatarUrl ?? "").trim();
}

function removeEmptyAvatarDirectories(startDirectory) {
  const normalizedRoot = path.resolve(avatarDirectoryRoot);
  let currentDirectory = path.resolve(startDirectory);

  while (currentDirectory !== normalizedRoot && currentDirectory.startsWith(`${normalizedRoot}${path.sep}`)) {
    if (!fs.existsSync(currentDirectory)) {
      currentDirectory = path.dirname(currentDirectory);
      continue;
    }

    const entries = fs.readdirSync(currentDirectory);
    if (entries.length > 0) {
      return;
    }

    fs.rmdirSync(currentDirectory);
    currentDirectory = path.dirname(currentDirectory);
  }
}

function removeLocalAvatarFileByUrl(avatarUrl, preservedRelativePath = "") {
  const relativePath = relativePathFromLocalMediaUrl(avatarUrl);
  if (!relativePath || relativePath === preservedRelativePath || !relativePath.startsWith("avatars/")) {
    return;
  }

  const resolvedFilePath = resolveMediaFilePath(avatarUrl);
  if (!resolvedFilePath) {
    return;
  }

  const normalizedFilePath = path.resolve(resolvedFilePath);
  const normalizedRoot = path.resolve(avatarDirectoryRoot);
  if (!normalizedFilePath.startsWith(`${normalizedRoot}${path.sep}`)) {
    return;
  }

  fs.rmSync(normalizedFilePath, { force: true });
  removeEmptyAvatarDirectories(path.dirname(normalizedFilePath));
}

export async function ingestUploadedAvatar({
  userId,
  uploadFilePath,
  originalFileName,
  mimetype,
  env = process.env,
} = {}) {
  const normalizedUserId = String(userId ?? "").trim();
  if (!normalizedUserId) {
    throw new HttpError(401, "User is not authenticated.");
  }

  const previousAvatarUrl = await getCurrentAvatarUrl(normalizedUserId);
  const extension = ensureAvatarFileLooksSupported(uploadFilePath, originalFileName, mimetype);
  const relativePath = `avatars/${normalizedUserId}/${crypto.randomUUID()}${extension}`;

  let persisted = null;
  try {
    persisted = await persistMediaFile({
      sourceFilePath: uploadFilePath,
      relativePath,
      contentType: avatarContentTypeByExtension.get(extension) ?? "application/octet-stream",
      cacheControl: "public, max-age=604800",
      env,
    });

    const user = await setUserAvatarUrl({
      userId: normalizedUserId,
      avatarUrl: persisted.publicUrl,
    });
    removeLocalAvatarFileByUrl(previousAvatarUrl, persisted.relativePath);
    return user;
  } catch (error) {
    if (persisted?.publicUrl) {
      removeLocalAvatarFileByUrl(persisted.publicUrl);
    }
    throw error;
  }
}

export async function removeUploadedAvatar({ userId } = {}) {
  const normalizedUserId = String(userId ?? "").trim();
  if (!normalizedUserId) {
    throw new HttpError(401, "User is not authenticated.");
  }

  const previousAvatarUrl = await getCurrentAvatarUrl(normalizedUserId);
  const user = await setUserAvatarUrl({
    userId: normalizedUserId,
    avatarUrl: "",
  });
  removeLocalAvatarFileByUrl(previousAvatarUrl);
  return user;
}
