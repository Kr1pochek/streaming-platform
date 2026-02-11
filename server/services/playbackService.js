import crypto from "node:crypto";

const DEFAULT_PLAYBACK_URL_TTL_MS = 15 * 60 * 1000;
const DEFAULT_EMBED_PLAYBACK_URL_TTL_MS = 6 * 60 * 60 * 1000;

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

function parsePositiveNumber(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function normalizeTrackId(trackId) {
  return String(trackId ?? "").trim();
}

function signaturePayload(trackId, expiresAt) {
  return `${normalizeTrackId(trackId)}.${Number(expiresAt)}`;
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ""));
  const rightBuffer = Buffer.from(String(right ?? ""));
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function playbackSigningSecret(env = process.env) {
  return String(env.PLAYBACK_SIGNING_SECRET ?? "").trim();
}

export function isPlaybackSigningRequired(env = process.env) {
  return parseBoolean(env.PLAYBACK_REQUIRE_SIGNED, false);
}

export function shouldEmbedSignedPlaybackUrl(env = process.env) {
  return parseBoolean(env.PLAYBACK_EMBED_SIGNED_URL, true);
}

export function getPlaybackUrlTtlMs(env = process.env) {
  return parsePositiveNumber(env.PLAYBACK_URL_TTL_MS, DEFAULT_PLAYBACK_URL_TTL_MS);
}

export function getEmbeddedPlaybackUrlTtlMs(env = process.env) {
  return parsePositiveNumber(env.PLAYBACK_EMBED_URL_TTL_MS, DEFAULT_EMBED_PLAYBACK_URL_TTL_MS);
}

export function createPlaybackSignature(trackId, expiresAt, secret = playbackSigningSecret(process.env)) {
  const normalizedTrackId = normalizeTrackId(trackId);
  if (!normalizedTrackId || !secret) {
    return "";
  }
  return crypto.createHmac("sha256", secret).update(signaturePayload(normalizedTrackId, expiresAt)).digest("base64url");
}

export function createSignedStreamUrl(
  trackId,
  {
    basePath = "/api/stream",
    nowMs = Date.now(),
    ttlMs = getPlaybackUrlTtlMs(),
    secret = playbackSigningSecret(process.env),
  } = {}
) {
  const normalizedTrackId = normalizeTrackId(trackId);
  const streamPath = `${String(basePath).replace(/\/+$/, "")}/${encodeURIComponent(normalizedTrackId)}`;
  if (!normalizedTrackId) {
    return {
      url: streamPath,
      expiresAt: null,
      signed: false,
    };
  }

  if (!secret) {
    return {
      url: streamPath,
      expiresAt: null,
      signed: false,
    };
  }

  const safeNowMs = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const safeTtlMs = parsePositiveNumber(ttlMs, DEFAULT_PLAYBACK_URL_TTL_MS);
  const expiresAt = safeNowMs + safeTtlMs;
  const signature = createPlaybackSignature(normalizedTrackId, expiresAt, secret);
  const query = new URLSearchParams({
    exp: String(expiresAt),
    sig: signature,
  });
  return {
    url: `${streamPath}?${query.toString()}`,
    expiresAt,
    signed: true,
  };
}

export function validateSignedPlaybackRequest({
  trackId,
  signature,
  expiresAt,
  nowMs = Date.now(),
  required = isPlaybackSigningRequired(process.env),
  secret = playbackSigningSecret(process.env),
} = {}) {
  const normalizedTrackId = normalizeTrackId(trackId);
  const normalizedSignature = String(signature ?? "").trim();
  const hasToken = Boolean(normalizedSignature) || String(expiresAt ?? "").trim() !== "";

  if (required && !secret) {
    return {
      ok: false,
      status: 500,
      message: "Playback signing secret is not configured.",
    };
  }

  if (!hasToken) {
    if (required) {
      return {
        ok: false,
        status: 403,
        message: "Signed playback token is required.",
      };
    }
    return { ok: true };
  }

  if (!secret) {
    return {
      ok: false,
      status: 403,
      message: "Signed playback token is invalid.",
    };
  }

  const parsedExpiresAt = Number.parseInt(String(expiresAt ?? ""), 10);
  if (!Number.isFinite(parsedExpiresAt)) {
    return {
      ok: false,
      status: 403,
      message: "Signed playback token is invalid.",
    };
  }
  if (parsedExpiresAt <= Number(nowMs)) {
    return {
      ok: false,
      status: 403,
      message: "Signed playback token has expired.",
    };
  }

  const expectedSignature = createPlaybackSignature(normalizedTrackId, parsedExpiresAt, secret);
  if (!safeCompare(expectedSignature, normalizedSignature)) {
    return {
      ok: false,
      status: 403,
      message: "Signed playback token is invalid.",
    };
  }

  return {
    ok: true,
    expiresAt: parsedExpiresAt,
  };
}
