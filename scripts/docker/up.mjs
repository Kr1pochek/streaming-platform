import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
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
  return String(error ?? "unknown error");
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function collectDockerDesktopCandidates() {
  const programFiles = uniqueValues([
    process.env.ProgramFiles,
    process.env.ProgramW6432,
    process.env["ProgramFiles(x86)"],
  ]);

  return uniqueValues([
    process.env.DOCKER_DESKTOP_PATH,
    ...programFiles.map((baseDirectory) =>
      path.join(baseDirectory, "Docker", "Docker", "Docker Desktop.exe")
    ),
  ]);
}

function runCommand(command, args, { inheritOutput = false, detached = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: inheritOutput ? "inherit" : ["ignore", "pipe", "pipe"],
      detached,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    if (!inheritOutput) {
      child.stdout?.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });
    }

    child.once("error", (error) => {
      resolve({
        code: null,
        stdout,
        stderr,
        error,
      });
    });

    child.once("exit", (code) => {
      resolve({
        code,
        stdout,
        stderr,
        error: null,
      });
    });

    if (detached) {
      child.unref();
    }
  });
}

async function getDockerEngineStatus() {
  const result = await runCommand("docker", ["version", "--format", "{{.Server.Version}}"]);
  if (result.error) {
    return {
      ready: false,
      reason: `Docker CLI is unavailable: ${errorMessage(result.error)}`,
    };
  }

  const serverVersion = result.stdout.trim();
  if (result.code === 0 && serverVersion) {
    return {
      ready: true,
      reason: `Docker engine ${serverVersion} is ready.`,
    };
  }

  const reason = result.stderr.trim() || result.stdout.trim() || "Docker engine is not ready yet.";
  return {
    ready: false,
    reason,
  };
}

async function startDockerDesktopIfPossible() {
  if (process.platform !== "win32") {
    return {
      started: false,
      reason: "Automatic Docker Desktop startup is only configured for Windows.",
    };
  }

  const executablePath = collectDockerDesktopCandidates().find((candidate) => existsSync(candidate));
  if (!executablePath) {
    return {
      started: false,
      reason:
        "Docker Desktop executable was not found. Start Docker Desktop manually or set DOCKER_DESKTOP_PATH.",
    };
  }

  const result = await runCommand(executablePath, [], { detached: true });
  if (result.error) {
    return {
      started: false,
      reason: `Failed to start Docker Desktop: ${errorMessage(result.error)}`,
    };
  }

  return {
    started: true,
    reason: `Docker Desktop launch requested via ${executablePath}.`,
  };
}

async function ensureDockerEngineReady() {
  const timeoutMs = parsePositiveInteger(process.env.DOCKER_WAIT_TIMEOUT_MS, 180_000);
  const intervalMs = parsePositiveInteger(process.env.DOCKER_WAIT_INTERVAL_MS, 3_000);

  let status = await getDockerEngineStatus();
  if (status.ready) {
    console.log(status.reason);
    return;
  }

  console.log(`Docker engine is not ready yet: ${status.reason}`);

  const startup = await startDockerDesktopIfPossible();
  if (startup.started) {
    console.log(startup.reason);
  } else if (process.platform === "win32") {
    console.log(startup.reason);
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(intervalMs);
    status = await getDockerEngineStatus();
    if (status.ready) {
      console.log(status.reason);
      return;
    }
    console.log(`Waiting for Docker engine... ${status.reason}`);
  }

  throw new Error(
    [
      `Docker engine did not become ready within ${Math.ceil(timeoutMs / 1000)} seconds.`,
      `Last status: ${status.reason}`,
      process.platform === "win32"
        ? "Open Docker Desktop manually, wait for Running, then run `npm run docker:up` again."
        : "Start Docker manually, then rerun `npm run docker:up`.",
    ].join(" ")
  );
}

async function runDockerComposeUp() {
  const composeArgs = ["compose", "up", "--build", "-d", ...process.argv.slice(2)];
  console.log(`Running: docker ${composeArgs.join(" ")}`);
  const result = await runCommand("docker", composeArgs, { inheritOutput: true });
  if (result.error) {
    throw new Error(`Failed to run docker compose: ${errorMessage(result.error)}`);
  }
  if (result.code !== 0) {
    throw new Error(`docker compose exited with code ${result.code ?? 1}.`);
  }
}

async function main() {
  await ensureDockerEngineReady();
  await runDockerComposeUp();
}

main().catch((error) => {
  console.error("Docker startup failed:", errorMessage(error));
  process.exitCode = 1;
});
