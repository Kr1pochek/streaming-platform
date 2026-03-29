import assert from "node:assert/strict";
import fs from "node:fs";
import { once } from "node:events";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { runSmokeCheck } from "../scripts/smoke-check.mjs";

function createSmokeServer({ readyStatus = 200 } = {}) {
  return createServer((req, res) => {
    if (req.url === "/api/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.url === "/api/ready") {
      const payload =
        readyStatus === 200 ? { ok: true, database: "up" } : { ok: false, database: "down" };
      res.writeHead(readyStatus, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
      return;
    }

    if (req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<!doctype html><html><body>ok</body></html>");
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
  });
}

async function startSmokeServer(options, t) {
  const server = createSmokeServer(options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

test("npm run smoke passes for healthy health/ready/client endpoints", async (t) => {
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"));
  assert.equal(packageJson.scripts?.smoke, "node --env-file-if-exists=.env scripts/smoke-check.mjs");
});

test("smoke script passes for healthy health/ready/client endpoints", async (t) => {
  const baseUrl = await startSmokeServer({}, t);
  const logs = [];
  const result = await runSmokeCheck(
    {
      baseUrl,
      checkClient: true,
      timeoutMs: 2000,
    },
    (line) => {
      logs.push(String(line));
    }
  );

  assert.equal(result.ok, true);
  assert.match(logs.join("\n"), /Smoke check passed\./);
});

test("smoke script fails when readiness check is down", async (t) => {
  const baseUrl = await startSmokeServer({ readyStatus: 503 }, t);
  const logs = [];
  const result = await runSmokeCheck(
    {
      baseUrl,
      timeoutMs: 2000,
    },
    (line) => {
      logs.push(String(line));
    }
  );

  assert.equal(result.ok, false);
  assert.match(logs.join("\n"), /FAIL ready/);
});
