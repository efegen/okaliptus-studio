// One-off database backup via pg_dump → compressed custom-format file in backend/backups/.
// Usage: npm run db:backup   (run from the backend/ directory)
//
// IMPORTANT: pg_dump must be >= the server's MAJOR version. It can dump from older
// servers but refuses one newer than itself ("server version mismatch"). On Windows
// this auto-selects the highest-versioned pg_dump under C:\Program Files\PostgreSQL\<N>\bin.
// Override with PG_DUMP=<full path to pg_dump(.exe)> if your install lives elsewhere.

import "dotenv/config";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required — set it in backend/.env.");
  process.exit(1);
}

function resolvePgDump(): string {
  // 1) Explicit override always wins.
  if (process.env.PG_DUMP) return process.env.PG_DUMP;

  // 2) Windows: pick the highest-versioned standard EnterpriseDB install so a
  //    newer server (e.g. 18.x) isn't dumped by an older pg_dump (e.g. 17.x).
  if (process.platform === "win32") {
    const base = "C:\\Program Files\\PostgreSQL";
    if (existsSync(base)) {
      const found = readdirSync(base)
        .map((name) => ({ major: Number.parseInt(name, 10), exe: path.join(base, name, "bin", "pg_dump.exe") }))
        .filter((c) => Number.isInteger(c.major) && existsSync(c.exe))
        .sort((a, b) => b.major - a.major);
      if (found.length > 0) return found[0].exe;
    }
  }

  // 3) Fall back to whatever is on PATH (Linux/macOS, or a custom setup).
  return "pg_dump";
}

const pgDump = resolvePgDump();

// Print which binary + version we're using so a future mismatch is obvious.
const probe = spawnSync(pgDump, ["--version"], { encoding: "utf8" });
if (probe.status !== 0) {
  console.error(`Could not execute pg_dump at: ${pgDump}`);
  console.error(probe.stderr?.trim() || probe.error?.message || "unknown error");
  console.error("Set PG_DUMP to the full path of a pg_dump whose version >= your server's.");
  process.exit(1);
}
console.log(`pg_dump: ${probe.stdout.trim()}  (${pgDump})`);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const backupDir = process.env.BACKUP_DIR ?? path.resolve(scriptDir, "..", "backups");
mkdirSync(backupDir, { recursive: true });

const d = new Date();
const p = (n: number) => String(n).padStart(2, "0");
const stamp =
  `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
  `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
const outFile = path.join(backupDir, `okaliptus-${stamp}.dump`);

console.log(`Backing up → ${outFile}`);
const result = spawnSync(
  pgDump,
  [databaseUrl, "--format=custom", "--no-owner", "--no-privileges", "--file", outFile],
  { stdio: ["ignore", "inherit", "inherit"] },
);

if (result.status !== 0) {
  console.error(`\npg_dump failed (exit ${result.status ?? "unknown"}).`);
  if (result.error) console.error(result.error.message);
  process.exit(1);
}

const sizeMb = (statSync(outFile).size / 1024 / 1024).toFixed(2);
console.log(`\n✓ Backup complete: ${outFile} (${sizeMb} MB)`);
console.log(`  Restore: pg_restore --clean --if-exists --no-owner -d "<TARGET_DATABASE_URL>" "${outFile}"`);

// Retention: prune local dumps older than BACKUP_KEEP_DAYS (default 14; set 0 to disable).
const keepDays = Number.parseInt(process.env.BACKUP_KEEP_DAYS ?? "14", 10);
if (Number.isFinite(keepDays) && keepDays > 0) {
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  let pruned = 0;
  for (const name of readdirSync(backupDir)) {
    if (!name.endsWith(".dump")) continue;
    const full = path.join(backupDir, name);
    if (statSync(full).mtimeMs < cutoff) {
      rmSync(full);
      pruned += 1;
    }
  }
  if (pruned > 0) console.log(`Pruned ${pruned} local dump(s) older than ${keepDays} days.`);
}
