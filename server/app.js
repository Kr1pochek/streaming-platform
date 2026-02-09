import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { createRateLimiter } from "./middleware/rateLimit.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { createApiRouter } from "./routes/apiRoutes.js";
import { HttpError, mediaDirectory } from "./services/catalogService.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const distDirectory = path.resolve(currentDirectory, "../dist");
const distIndexFile = path.join(distDirectory, "index.html");

function shouldServeClientBuild() {
  const configured = String(process.env.SERVE_CLIENT ?? "true").toLowerCase().trim();
  if (configured === "false" || configured === "0" || configured === "no") {
    return false;
  }
  return fs.existsSync(distIndexFile);
}

function createCorsOptions() {
  const configuredOrigins = String(process.env.CORS_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const allowAnyOrigin = configuredOrigins.includes("*");

  return {
    origin(origin, callback) {
      if (!origin || allowAnyOrigin || configuredOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("CORS policy violation"));
    },
  };
}

export function createApp() {
  const app = express();
  const serveClientBuild = shouldServeClientBuild();

  app.set("trust proxy", true);
  app.use(requestLogger);
  app.use(cors(createCorsOptions()));
  app.use(express.json({ limit: "1mb" }));
  app.use(
    "/api",
    createRateLimiter({
      windowMs: 60_000,
      max: Number(process.env.API_RATE_LIMIT_MAX ?? 180),
      keyResolver: (req) => `api:${req.ip}`,
    })
  );
  app.use("/api/media", express.static(mediaDirectory));
  app.use("/api", createApiRouter());

  if (serveClientBuild) {
    app.use(express.static(distDirectory));
    app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
      res.sendFile(distIndexFile);
    });
  }

  app.use((_req, _res, next) => {
    next(new HttpError(404, "Ресурс не найден."));
  });
  app.use(errorHandler);
  return app;
}
