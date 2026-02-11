import { HttpError } from "../services/catalogService.js";

export function resolveRequestIp(req) {
  return String(req.ip ?? req.socket?.remoteAddress ?? req.connection?.remoteAddress ?? "unknown");
}

function defaultKeyResolver(req) {
  return `${resolveRequestIp(req)}:${req.path}`;
}

export function createRateLimiter({
  windowMs = 60_000,
  max = 120,
  maxEntries = 10_000,
  cleanupIntervalMs = 60_000,
  keyResolver = defaultKeyResolver,
} = {}) {
  const storage = new Map();
  let lastCleanupAt = Date.now();

  const safeWindowMs = Number.isFinite(Number(windowMs)) ? Math.max(Number(windowMs), 1) : 60_000;
  const safeMax = Number.isFinite(Number(max)) ? Math.max(Number(max), 1) : 120;
  const safeMaxEntries = Number.isFinite(Number(maxEntries))
    ? Math.max(Number(maxEntries), safeMax)
    : 10_000;
  const safeCleanupIntervalMs = Number.isFinite(Number(cleanupIntervalMs))
    ? Math.max(Number(cleanupIntervalMs), 1_000)
    : safeWindowMs;

  function cleanup(now, { force = false } = {}) {
    if (!force && now - lastCleanupAt < safeCleanupIntervalMs) {
      return;
    }
    for (const [key, value] of storage.entries()) {
      if (!value || value.resetAt <= now) {
        storage.delete(key);
      }
    }
    lastCleanupAt = now;
  }

  return function rateLimit(req, _res, next) {
    const now = Date.now();
    cleanup(now);

    const key = keyResolver(req);
    const current = storage.get(key);

    if (!current || current.resetAt <= now) {
      if (storage.size >= safeMaxEntries) {
        cleanup(now, { force: true });
      }
      while (storage.size >= safeMaxEntries) {
        const oldestKey = storage.keys().next().value;
        if (oldestKey === undefined) {
          break;
        }
        storage.delete(oldestKey);
      }

      storage.set(key, { count: 1, resetAt: now + safeWindowMs });
      next();
      return;
    }

    if (current.count >= safeMax) {
      next(new HttpError(429, "Too many requests. Please try again later."));
      return;
    }

    current.count += 1;
    storage.set(key, current);
    next();
  };
}
