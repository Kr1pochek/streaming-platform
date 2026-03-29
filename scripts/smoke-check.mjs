import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);

export function parseArgs(argv) {
  const options = {
    baseUrl: String(process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:4000").trim(),
    checkClient: false,
    timeoutMs: 5000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] ?? "").trim();
    if (token === "--url") {
      const value = String(argv[index + 1] ?? "").trim();
      if (value) {
        options.baseUrl = value;
      }
      index += 1;
      continue;
    }
    if (token === "--client") {
      options.checkClient = true;
      continue;
    }
    if (token === "--timeout") {
      const value = Number.parseInt(String(argv[index + 1] ?? ""), 10);
      if (Number.isFinite(value) && value > 0) {
        options.timeoutMs = value;
      }
      index += 1;
    }
  }

  return options;
}

export function normalizeBaseUrl(value) {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

export async function request(url, { timeoutMs, expectJson = true } = {}) {
  const response = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(timeoutMs),
  });

  let payload = null;
  if (expectJson) {
    payload = await response.json().catch(() => null);
  } else {
    payload = await response.text().catch(() => "");
  }

  return {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    payload,
  };
}

export async function runSmokeCheck(options = {}, log = console.log) {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:4000");
  const timeoutMs = Number(options.timeoutMs ?? 5000);
  const checkClient = Boolean(options.checkClient);
  const checks = [
    {
      label: "health",
      url: `${baseUrl}/api/health`,
      expectJson: true,
      validate(result) {
        return result.ok && result.payload?.ok === true;
      },
    },
    {
      label: "ready",
      url: `${baseUrl}/api/ready`,
      expectJson: true,
      validate(result) {
        return result.ok && result.payload?.ok === true;
      },
    },
  ];

  if (checkClient) {
    checks.push({
      label: "client",
      url: `${baseUrl}/`,
      expectJson: false,
      validate(result) {
        const contentType = String(result.headers.get("content-type") ?? "").toLowerCase();
        return result.ok && contentType.includes("text/html");
      },
    });
  }

  let failed = false;

  for (const check of checks) {
    try {
      const result = await request(check.url, {
        timeoutMs,
        expectJson: check.expectJson,
      });
      const passed = check.validate(result);
      if (!passed) {
        failed = true;
      }

      log(`${passed ? "OK" : "FAIL"} ${check.label} ${check.url} status=${result.status}`);
    } catch (error) {
      failed = true;
      const message = error instanceof Error ? error.message : "unknown error";
      log(`FAIL ${check.label} ${check.url} error=${message}`);
    }
  }

  if (failed) {
    return { ok: false };
  }

  log("Smoke check passed.");
  return { ok: true };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = await runSmokeCheck({
    baseUrl: options.baseUrl,
    checkClient: options.checkClient,
    timeoutMs: options.timeoutMs,
  });
  if (!result.ok) {
    process.exitCode = 1;
  }
}

function isDirectRun() {
  const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
  return entryPath === currentFilePath;
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
