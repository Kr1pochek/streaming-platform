import { DEFAULT_ERROR_MESSAGE } from "../services/catalogService.js";

export function errorHandler(error, _req, res, next) {
  void next;
  const status = Number(error?.status) || 500;
  const message = status >= 500 ? DEFAULT_ERROR_MESSAGE : error?.message || DEFAULT_ERROR_MESSAGE;
  if (status >= 500) {
    console.error(error);
  }
  res.status(status).json({ message });
}
