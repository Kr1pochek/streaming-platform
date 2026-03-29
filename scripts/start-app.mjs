import { spawn } from "node:child_process";
import process from "node:process";
import { Client } from "pg";

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function getDatabaseConfig() {
  return {
    host: process.env.PGHOST ?? "127.0.0.1",
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE ?? "music_app",
    user: process.env.PGUSER ?? "postgres",
    password: process.env.PGPASSWORD ?? "",
  };
}

function sleep(timeoutMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}

function errorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return "unknown error";
}

async function waitForDatabase() {
  const retries = parsePositiveInteger(process.env.DB_WAIT_RETRIES, 30);
  const intervalMs = parsePositiveInteger(process.env.DB_WAIT_INTERVAL_MS, 2000);
  const config = getDatabaseConfig();

  console.log(`Waiting for PostgreSQL at ${config.host}:${config.port}/${config.database}...`);

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const client = new Client(config);
    try {
      await client.connect();
      await client.query("select 1;");
      await client.end();
      console.log(`PostgreSQL is ready after ${attempt} attempt(s).`);
      return;
    } catch (error) {
      await client.end().catch(() => {});
      if (attempt >= retries) {
        throw new Error(`Database did not become ready: ${errorMessage(error)}`);
      }

      console.log(`Database not ready yet (${attempt}/${retries}): ${errorMessage(error)}`);
      await sleep(intervalMs);
    }
  }
}

function runNodeScript(scriptPath, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      stdio: "inherit",
      env: process.env,
    });

    child.once("error", (error) => {
      reject(new Error(`${label} failed to start: ${errorMessage(error)}`));
    });

    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${label} exited due to signal ${signal}.`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`${label} exited with code ${code ?? 1}.`));
        return;
      }
      resolve();
    });
  });
}

async function runServer() {
  const child = spawn(process.execPath, ["server/index.js"], {
    stdio: "inherit",
    env: process.env,
  });

  const forwardSignal = (signal) => {
    if (!child.killed) {
      child.kill(signal);
    }
  };

  process.on("SIGINT", forwardSignal);
  process.on("SIGTERM", forwardSignal);

  try {
    const exit = await new Promise((resolve, reject) => {
      child.once("error", (error) => {
        reject(new Error(`API server failed to start: ${errorMessage(error)}`));
      });
      child.once("exit", (code, signal) => {
        resolve({ code, signal });
      });
    });

    if (exit.signal) {
      process.exitCode = 0;
      return;
    }

    process.exitCode = Number(exit.code ?? 0);
  } finally {
    process.off("SIGINT", forwardSignal);
    process.off("SIGTERM", forwardSignal);
  }
}

async function main() {
  await waitForDatabase();
  console.log("Running database migrations...");
  await runNodeScript("scripts/db/migrate.mjs", "Database migrations");
  console.log("Seeding catalog data...");
  await runNodeScript("scripts/db/seed.mjs", "Database seed");
  console.log("Starting API server...");
  await runServer();
}

main().catch((error) => {
  console.error("Application startup failed:", error);
  process.exitCode = 1;
});
