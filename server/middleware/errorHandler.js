import { DEFAULT_ERROR_MESSAGE } from "../services/catalogService.js";

export function errorHandler(error, _req, res, next) {
  void next;
  let status = Number(error?.status) || 500;
  let message = status >= 500 ? DEFAULT_ERROR_MESSAGE : error?.message || DEFAULT_ERROR_MESSAGE;

  if (error?.name === "MulterError") {
    if (error.code === "LIMIT_FILE_SIZE") {
      status = 413;
      message = "Audio file is too large.";
    } else {
      status = 400;
      message = error.message || "Invalid upload payload.";
    }
  }

  if (status >= 500) {
    console.error(error);
  }
  res.status(status).json({ message });
}
