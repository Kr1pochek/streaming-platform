import { HttpError } from "../services/catalogService.js";

function defaultKeyResolver(req) {
  return `${req.ip}:${req.path}`;
}

export function createRateLimiter({
  windowMs = 60_000,
  max = 120,
  keyResolver = defaultKeyResolver,
} = {}) {
  const storage = new Map();

  return function rateLimit(req, _res, next) {
    const now = Date.now();
    const key = keyResolver(req);
    const current = storage.get(key);

    if (!current || current.resetAt <= now) {
      storage.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (current.count >= max) {
      next(new HttpError(429, "Слишком много запросов. Попробуй немного позже."));
      return;
    }

    current.count += 1;
    storage.set(key, current);
    next();
  };
}
