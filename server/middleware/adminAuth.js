import { HttpError } from "../services/catalogService.js";

export function requireAdmin(req, _res, next) {
  if (!req.auth?.userId) {
    throw new HttpError(401, "Authentication required for admin access.");
  }

  if (!req.auth.user?.isAdmin) {
    throw new HttpError(403, "Admin permissions required for this action.");
  }

  next();
}
