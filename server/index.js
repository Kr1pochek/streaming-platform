import { createApp } from "./app.js";
import {
  assertCatalogSchemaReady,
  closePool,
  validateCatalogAudioFiles,
} from "./services/catalogService.js";

const app = createApp();

async function startServer() {
  await assertCatalogSchemaReady();

  const validation = await validateCatalogAudioFiles();
  const warningSuffix = validation.hasWarnings
    ? ` (${validation.missingFiles.length} local file warnings, filtered from catalog until media is restored)`
    : "";
  console.log(`Audio catalog checked for ${validation.totalTracks} tracks${warningSuffix}.`);

  const port = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);
  const host = process.env.API_HOST ?? (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
  const server = app.listen(port, host, () => {
    console.log(`API server is running on http://${host}:${port}`);
  });

  const shutdown = async () => {
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

startServer().catch((error) => {
  console.error("Failed to start API server:", error);
  process.exit(1);
});
