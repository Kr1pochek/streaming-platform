import crypto from "node:crypto";
import { pool } from "./catalogService.js";

const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS ?? 1000 * 60 * 60 * 24 * 30);
const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 128;
const MIN_USERNAME_LENGTH = 3;
const MAX_USERNAME_LENGTH = 32;
const MAX_DISPLAY_NAME_LENGTH = 48;
const PASSWORD_RESET_TOKEN_TTL_MS = Number(
  process.env.PASSWORD_RESET_TOKEN_TTL_MS ?? 1000 * 60 * 20
);
const USERNAME_UNIQUE_INDEX_NAME = "idx_users_username_lower";

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
      message: `Username must be between ${MIN_USERNAME_LENGTH} and ${MAX_USERNAME_LENGTH} characters.`,
    };
  }
  if (!usernamePattern.test(value)) {
    return {
      valid: false,
      message: "Username can include only latin letters, digits, dot, hyphen, and underscore.",
    };
  }
  return { valid: true, value };
}

export function validatePassword(password = "") {
  const value = String(password ?? "");
  if (value.length < MIN_PASSWORD_LENGTH || value.length > MAX_PASSWORD_LENGTH) {
    return {
      valid: false,
      message: `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`,
    };
  }
  return { valid: true, value };
}

export function validateDisplayName(displayName = "", fallback = "") {
  const value = sanitizeDisplayName(displayName, fallback);
  if (value.length > MAX_DISPLAY_NAME_LENGTH) {
    return {
      valid: false,
      message: `Display name must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer.`,
    };
  }
  return { valid: true, value };
}

export function isUsernameUniqueViolation(error) {
  const code = String(error?.code ?? "");
  const constraint = String(error?.constraint ?? "").toLowerCase();
  const detail = String(error?.detail ?? "").toLowerCase();
  const message = String(error?.message ?? "").toLowerCase();

  if (code === "23505" && constraint === USERNAME_UNIQUE_INDEX_NAME) {
    return true;
  }
  if (code === "23505" && constraint.includes("username")) {
    return true;
  }
  return detail.includes("username") || message.includes(USERNAME_UNIQUE_INDEX_NAME);
}

export function resolveSeedUserConfig(env = process.env) {
  const rawUsername = String(env.SEED_USERNAME ?? "").trim();
  const rawPassword = String(env.SEED_PASSWORD ?? "");
  const rawDisplayName = String(env.SEED_DISPLAY_NAME ?? "");

  if (!rawUsername && !rawPassword) {
    return null;
  }
  if (!rawUsername || !rawPassword) {
    throw new Error("SEED_USERNAME and SEED_PASSWORD must be provided together.");
  }

  const username = sanitizeUsername(rawUsername);
  return {
    username,
    password: rawPassword,
    displayName: sanitizeDisplayName(rawDisplayName, username),
  };
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
  const displayNameValidation = validateDisplayName(displayName, normalizedUsername);
  if (!displayNameValidation.valid) {
    const error = new Error(displayNameValidation.message);
    error.status = 400;
    throw error;
  }

  const normalizedDisplayName = displayNameValidation.value;
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
    if (isUsernameUniqueViolation(error)) {
      const conflictError = new Error("User with this username already exists.");
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

export async function updateUserProfile({ userId, displayName }) {
  const normalizedUserId = String(userId ?? "").trim();
  if (!normalizedUserId) {
    const error = new Error("User is not authenticated.");
    error.status = 401;
    throw error;
  }

  const { rows: existingRows } = await pool.query(
    `
    select username
    from users
    where id = $1
    limit 1;
  `,
    [normalizedUserId]
  );
  const existingUser = existingRows[0];
  if (!existingUser) {
    const error = new Error("User not found.");
    error.status = 404;
    throw error;
  }

  const displayNameValidation = validateDisplayName(displayName, existingUser.username);
  if (!displayNameValidation.valid) {
    const error = new Error(displayNameValidation.message);
    error.status = 400;
    throw error;
  }

  const { rows } = await pool.query(
    `
    update users
    set display_name = $2
    where id = $1
    returning id, username, display_name, created_at;
  `,
    [normalizedUserId, displayNameValidation.value]
  );

  return toPublicUser(rows[0]);
}

export async function changeUserPassword({ userId, currentPassword, newPassword }) {
  const normalizedUserId = String(userId ?? "").trim();
  if (!normalizedUserId) {
    const error = new Error("User is not authenticated.");
    error.status = 401;
    throw error;
  }

  const currentPasswordValue = String(currentPassword ?? "");
  if (!currentPasswordValue) {
    const error = new Error("Current password is required.");
    error.status = 400;
    throw error;
  }

  const newPasswordValidation = validatePassword(newPassword);
  if (!newPasswordValidation.valid) {
    const error = new Error(newPasswordValidation.message);
    error.status = 400;
    throw error;
  }

  const { rows } = await pool.query(
    `
    select id, password_hash, password_salt
    from users
    where id = $1
    limit 1;
  `,
    [normalizedUserId]
  );
  const user = rows[0];
  if (!user) {
    const error = new Error("User not found.");
    error.status = 404;
    throw error;
  }

  const expectedBuffer = Buffer.from(user.password_hash, "hex");
  const actualBuffer = Buffer.from(hashPassword(currentPasswordValue, user.password_salt), "hex");
  if (
    expectedBuffer.length !== actualBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    const error = new Error("Current password is incorrect.");
    error.status = 401;
    throw error;
  }

  const nextSalt = crypto.randomBytes(16).toString("hex");
  const nextPasswordHash = hashPassword(newPasswordValidation.value, nextSalt);
  await pool.query(
    `
    update users
    set password_hash = $2,
        password_salt = $3
    where id = $1;
  `,
    [normalizedUserId, nextPasswordHash, nextSalt]
  );

  return { success: true };
}

export async function requestPasswordResetToken({ username }) {
  const normalizedUsername = sanitizeUsername(username);
  if (!normalizedUsername) {
    return { accepted: true };
  }

  const { rows } = await pool.query(
    `
    select id
    from users
    where lower(username) = lower($1)
    limit 1;
  `,
    [normalizedUsername]
  );
  const user = rows[0];
  if (!user?.id) {
    return { accepted: true };
  }

  const token = crypto.randomBytes(36).toString("base64url");
  const tokenHash = hashToken(token);
  const resetTokenId = `prt-${crypto.randomUUID()}`;
  const createdAt = nowMs();
  const expiresAt = createdAt + PASSWORD_RESET_TOKEN_TTL_MS;

  await pool.query(
    `
    delete from password_reset_tokens
    where user_id = $1
       or expires_at <= $2
       or used_at is not null;
  `,
    [user.id, createdAt]
  );

  await pool.query(
    `
    insert into password_reset_tokens (id, user_id, token_hash, created_at, expires_at)
    values ($1, $2, $3, $4, $5);
  `,
    [resetTokenId, user.id, tokenHash, createdAt, expiresAt]
  );

  return {
    accepted: true,
    token,
    expiresAt,
  };
}

export async function resetPasswordWithToken({ username, token, newPassword }) {
  const normalizedUsername = sanitizeUsername(username);
  const normalizedToken = String(token ?? "").trim();
  if (!normalizedUsername || !normalizedToken) {
    const error = new Error("Username and reset token are required.");
    error.status = 400;
    throw error;
  }

  const newPasswordValidation = validatePassword(newPassword);
  if (!newPasswordValidation.valid) {
    const error = new Error(newPasswordValidation.message);
    error.status = 400;
    throw error;
  }

  const tokenHash = hashToken(normalizedToken);
  const now = nowMs();
  const { rows } = await pool.query(
    `
    select
      prt.id as "resetTokenId",
      prt.user_id as "userId"
    from password_reset_tokens prt
    join users u on u.id = prt.user_id
    where prt.token_hash = $1
      and lower(u.username) = lower($2)
      and prt.used_at is null
      and prt.expires_at > $3
    limit 1;
  `,
    [tokenHash, normalizedUsername, now]
  );

  const resetRow = rows[0];
  if (!resetRow?.userId) {
    const error = new Error("Reset token is invalid or expired.");
    error.status = 400;
    throw error;
  }

  const nextSalt = crypto.randomBytes(16).toString("hex");
  const nextPasswordHash = hashPassword(newPasswordValidation.value, nextSalt);
  await pool.query(
    `
    update users
    set password_hash = $2,
        password_salt = $3
    where id = $1;
  `,
    [resetRow.userId, nextPasswordHash, nextSalt]
  );
  await pool.query(
    `
    update password_reset_tokens
    set used_at = $2
    where id = $1;
  `,
    [resetRow.resetTokenId, now]
  );

  await revokeUserSessions(resetRow.userId);
  return { success: true };
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
  const seedConfig = resolveSeedUserConfig(process.env);
  if (!seedConfig) {
    return null;
  }

  const { rows } = await pool.query(
    `
    select id, username, display_name, created_at
    from users
    where lower(username) = lower($1)
    limit 1;
  `,
    [seedConfig.username]
  );

  if (rows[0]) {
    return toPublicUser(rows[0]);
  }

  return createUserAccount(seedConfig);
}
