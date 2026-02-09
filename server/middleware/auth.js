import { HttpError } from "../services/catalogService.js";
import { resolveSession } from "../services/authService.js";

function readBearerToken(req) {
  const authHeader = String(req.headers.authorization ?? "").trim();
  if (!authHeader) {
    return "";
  }

  const [scheme, value] = authHeader.split(/\s+/, 2);
  if (!scheme || !value) {
    return "";
  }
  if (scheme.toLowerCase() !== "bearer") {
    return "";
  }
  return value.trim();
}

export async function optionalAuth(req, _res, next) {
  try {
    const token = readBearerToken(req);
    if (!token) {
      req.auth = null;
      next();
      return;
    }

    const session = await resolveSession(token);
    req.auth = session
      ? {
          ...session,
          token,
        }
      : null;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAuth(req, _res, next) {
  if (!req.auth?.userId) {
    next(new HttpError(401, "Нужна авторизация."));
    return;
  }
  next();
}
