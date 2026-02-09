import crypto from "node:crypto";
import { pool } from "./catalogService.js";

const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS ?? 1000 * 60 * 60 * 24 * 30);
const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 128;
const MIN_USERNAME_LENGTH = 3;
const MAX_USERNAME_LENGTH = 32;

function nowMs() {
  return Date.now();
}

function sanitizeUsername(value = "") {
  return String(value ?? "").trim().toLowerCase();
}

function sanitizeDisplayName(value = "", fallback = "") {
  const cleaned = String(value ?? "").trim();
  return cleaned || fallback;
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function toPublicUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name ?? row.displayName ?? row.username,
    createdAt: Number(row.created_at ?? row.createdAt ?? 0),
  };
}

export function validateUsername(username = "") {
  const value = sanitizeUsername(username);
  const usernamePattern = /^[a-z0-9._-]+$/;
  if (value.length < MIN_USERNAME_LENGTH || value.length > MAX_USERNAME_LENGTH) {
    return {
      valid: false,
      message: `Логин должен быть длиной от ${MIN_USERNAME_LENGTH} до ${MAX_USERNAME_LENGTH} символов.`,
    };
  }
  if (!usernamePattern.test(value)) {
    return {
      valid: false,
      message: "Логин может содержать только латинские буквы, цифры, точку, дефис и нижнее подчеркивание.",
    };
  }
  return { valid: true, value };
}

export function validatePassword(password = "") {
  const value = String(password ?? "");
  if (value.length < MIN_PASSWORD_LENGTH || value.length > MAX_PASSWORD_LENGTH) {
    return {
      valid: false,
      message: `Пароль должен быть длиной от ${MIN_PASSWORD_LENGTH} до ${MAX_PASSWORD_LENGTH} символов.`,
    };
  }
  return { valid: true, value };
}

export async function createUserAccount({ username, password, displayName }) {
  const usernameValidation = validateUsername(username);
  if (!usernameValidation.valid) {
    const error = new Error(usernameValidation.message);
    error.status = 400;
    throw error;
  }

  const passwordValidation = validatePassword(password);
  if (!passwordValidation.valid) {
    const error = new Error(passwordValidation.message);
    error.status = 400;
    throw error;
  }

  const normalizedUsername = usernameValidation.value;
  const normalizedDisplayName = sanitizeDisplayName(displayName, normalizedUsername);
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(passwordValidation.value, salt);
  const userId = `usr-${crypto.randomUUID()}`;
  const createdAt = nowMs();

  try {
    const { rows } = await pool.query(
      `
      insert into users (id, username, display_name, password_hash, password_salt, created_at)
      values ($1, $2, $3, $4, $5, $6)
      returning id, username, display_name, created_at;
    `,
      [userId, normalizedUsername, normalizedDisplayName, passwordHash, salt, createdAt]
    );

    await pool.query(
      `
      insert into user_states (user_id, liked_track_ids, followed_artist_ids, history_track_ids, updated_at)
      values ($1, array[]::text[], array[]::text[], array[]::text[], $2)
      on conflict (user_id) do nothing;
    `,
      [userId, createdAt]
    );

    return toPublicUser(rows[0]);
  } catch (error) {
    if (String(error?.message ?? "").toLowerCase().includes("idx_users_username_lower")) {
      const conflictError = new Error("Пользователь с таким логином уже существует.");
      conflictError.status = 409;
      throw conflictError;
    }
    throw error;
  }
}

export async function verifyUserCredentials({ username, password }) {
  const normalizedUsername = sanitizeUsername(username);
  const rawPassword = String(password ?? "");
  if (!normalizedUsername || !rawPassword) {
    return null;
  }

  const { rows } = await pool.query(
    `
    select id, username, display_name, password_hash, password_salt, created_at
    from users
    where lower(username) = lower($1)
    limit 1;
  `,
    [normalizedUsername]
  );

  const user = rows[0];
  if (!user) {
    return null;
  }

  const candidateHash = hashPassword(rawPassword, user.password_salt);
  const expectedBuffer = Buffer.from(user.password_hash, "hex");
  const actualBuffer = Buffer.from(candidateHash, "hex");
  if (
    expectedBuffer.length !== actualBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    return null;
  }

  return toPublicUser(user);
}

export async function createSession(userId) {
  const token = crypto.randomBytes(48).toString("base64url");
  const tokenDigest = hashToken(token);
  const sessionId = `sess-${crypto.randomUUID()}`;
  const createdAt = nowMs();
  const expiresAt = createdAt + SESSION_TTL_MS;

  await pool.query(
    `
    insert into user_sessions (id, user_id, token_hash, created_at, expires_at)
    values ($1, $2, $3, $4, $5);
  `,
    [sessionId, userId, tokenDigest, createdAt, expiresAt]
  );

  return {
    token,
    sessionId,
    expiresAt,
  };
}

export async function resolveSession(token) {
  const normalizedToken = String(token ?? "").trim();
  if (!normalizedToken) {
    return null;
  }

  const tokenDigest = hashToken(normalizedToken);
  const now = nowMs();
  const { rows } = await pool.query(
    `
    select
      s.id as "sessionId",
      s.user_id as "userId",
      s.expires_at as "expiresAt",
      u.id,
      u.username,
      u.display_name,
      u.created_at
    from user_sessions s
    join users u on u.id = s.user_id
    where s.token_hash = $1
      and s.expires_at > $2
    limit 1;
  `,
    [tokenDigest, now]
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    sessionId: row.sessionId,
    userId: row.userId,
    expiresAt: Number(row.expiresAt ?? 0),
    user: toPublicUser(row),
  };
}

export async function revokeSession(token) {
  const normalizedToken = String(token ?? "").trim();
  if (!normalizedToken) {
    return;
  }

  const tokenDigest = hashToken(normalizedToken);
  await pool.query("delete from user_sessions where token_hash = $1;", [tokenDigest]);
}

export async function revokeUserSessions(userId) {
  await pool.query("delete from user_sessions where user_id = $1;", [userId]);
}

export async function pruneExpiredSessions() {
  const now = nowMs();
  await pool.query("delete from user_sessions where expires_at <= $1;", [now]);
}

export async function ensureSeedUser() {
  const seedUsername = sanitizeUsername(process.env.SEED_USERNAME ?? "roman");
  const seedPassword = String(process.env.SEED_PASSWORD ?? "roman123");
  const seedDisplayName = sanitizeDisplayName(process.env.SEED_DISPLAY_NAME ?? "Роман", seedUsername);

  const { rows } = await pool.query(
    `
    select id, username, display_name, created_at
    from users
    where lower(username) = lower($1)
    limit 1;
  `,
    [seedUsername]
  );

  if (rows[0]) {
    return toPublicUser(rows[0]);
  }

  return createUserAccount({
    username: seedUsername,
    password: seedPassword,
    displayName: seedDisplayName,
  });
}
