import { createServer } from "node:http";

import { env } from "./config/env.js";
import { closeDatabaseConnection, verifyDatabaseConnection } from "./db/connection.js";
import { createApp } from "./server/app.js";

async function main(): Promise<void> {
  await verifyDatabaseConnection();

  const app = createApp();
  const server = createServer(app);

  server.listen(env.port, () => {
    console.log(`Backend server listening on port ${env.port}.`);
  });

  const shutdown = async (signal: string) => {
    console.log(`${signal} received, shutting down.`);

    server.close(async () => {
      await closeDatabaseConnection();
      process.exit(0);
    });
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

main().catch(async (error) => {
  console.error("Backend startup failed.");
  console.error(error);
  await closeDatabaseConnection();
  process.exit(1);
});
