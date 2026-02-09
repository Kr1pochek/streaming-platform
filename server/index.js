import { createApp } from "./app.js";
import {
  assertCatalogSchemaReady,
  closePool,
  validateCatalogAudioFiles,
} from "./services/catalogService.js";

const app = createApp();

async function startServer() {
  await assertCatalogSchemaReady();

  const validatedTracksCount = await validateCatalogAudioFiles();
  console.log(`Audio files validated for ${validatedTracksCount} tracks.`);

  const port = Number(process.env.API_PORT ?? 4000);
  const host = process.env.API_HOST ?? "127.0.0.1";
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
