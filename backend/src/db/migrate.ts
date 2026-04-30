import { closeDatabaseConnection } from "./connection.js";
import { runMigrations } from "./migrations/runner.js";

async function main(): Promise<void> {
  const executedMigrations = await runMigrations();

  if (executedMigrations.length === 0) {
    console.log("No pending migrations.");
  } else {
    console.log(`Executed migrations: ${executedMigrations.join(", ")}`);
  }
}

main()
  .catch((error) => {
    console.error("Migration runner failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabaseConnection();
  });
