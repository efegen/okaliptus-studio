/**
 * Master smoke runner.
 *
 * Discovers every NN-*.ts file in this directory and runs them sequentially as
 * isolated child processes (each file owns its own pg pool lifecycle via
 * closePool). Aggregates results, prints a summary, exits non-zero on any
 * failure.
 *
 * Usage:
 *   npm run smoke                  # run all
 *   npm run smoke -- --bail        # stop at first failure
 *   npm run smoke -- --only 11,99  # run only these numbered files
 *   npm run smoke:single -- 11     # alias for --only 11
 *
 * Note: tests share the same Postgres database. KPI snapshots inside tests are
 * delta-based to tolerate residue from earlier runs; full reset is `npm run
 * smoke:reset`.
 */

import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

const G = "\x1b[32m";
const R = "\x1b[31m";
const Y = "\x1b[33m";
const C = "\x1b[36m";
const B = "\x1b[1m";
const X = "\x1b[0m";

type CliArgs = {
  bail: boolean;
  only: Set<string> | null;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { bail: false, only: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--bail") {
      args.bail = true;
    } else if (a === "--only") {
      const next = argv[i + 1];
      if (next) {
        args.only = new Set(next.split(",").map(s => s.trim()).filter(Boolean));
        i++;
      }
    } else if (/^\d+(,\d+)*$/.test(a)) {
      // Bare positional like "11,99" → treat as --only
      args.only = new Set(a.split(",").map(s => s.trim()).filter(Boolean));
    }
  }
  return args;
}

function discoverSmokeFiles(): string[] {
  const files = readdirSync(__dirname)
    .filter(f => /^\d{2}-.*\.ts$/.test(f))
    .sort();
  return files;
}

function fileNumber(file: string): string {
  const m = file.match(/^(\d{2})-/);
  return m ? m[1] : "??";
}

// shell:true gerekli (Windows'ta npx → npx.cmd shim, Node 24 CVE-2024-27980
// patch'i sonrası shell:false ile .cmd çağrısı EINVAL atıyor). shell:true ile
// path'teki boşluklar (örn. "Okaliptus Studio") split olmasın diye filePath'i
// çift tırnakla sarmalıyoruz; cmd, sh, bash hepsi bu quoting'i tanır.
function quoteForShell(s: string): string {
  // İçinde " yoksa basit çift tırnak yeterli (bizim use case'de yok).
  return `"${s}"`;
}

function runOne(filePath: string): Promise<{ code: number; durationMs: number }> {
  return new Promise(resolve => {
    const start = Date.now();
    const child = spawn("npx", ["tsx", quoteForShell(filePath)], {
      stdio: "inherit",
      shell: true,
      env: { ...process.env, FORCE_COLOR: "1" },
    });
    child.on("exit", code => {
      resolve({ code: code ?? 1, durationMs: Date.now() - start });
    });
    child.on("error", err => {
      console.error(`spawn error: ${(err as Error).message}`);
      resolve({ code: 1, durationMs: Date.now() - start });
    });
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const allFiles = discoverSmokeFiles();
  const targets = args.only
    ? allFiles.filter(f => args.only!.has(fileNumber(f)))
    : allFiles;

  if (targets.length === 0) {
    console.log(`${Y}No smoke files matched.${X}`);
    process.exit(0);
  }

  console.log(`${B}${C}━━━ Running ${targets.length} smoke file(s) ━━━${X}\n`);

  const results: Array<{ file: string; code: number; durationMs: number }> = [];
  const totalStart = Date.now();

  for (const file of targets) {
    const filePath = join(__dirname, file);
    console.log(`${B}${C}▶ ${file}${X}`);
    const r = await runOne(filePath);
    results.push({ file, code: r.code, durationMs: r.durationMs });
    if (args.bail && r.code !== 0) {
      console.log(`\n${Y}--bail: stopping at first failure (${file}).${X}`);
      break;
    }
  }

  const totalMs = Date.now() - totalStart;
  const failed = results.filter(r => r.code !== 0);

  console.log(`\n${B}${Y}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${X}`);
  console.log(`${B}SMOKE SUMMARY${X}`);
  for (const r of results) {
    const mark = r.code === 0 ? `${G}✓${X}` : `${R}✗${X}`;
    const dur = (r.durationMs / 1000).toFixed(1);
    console.log(`  ${mark} ${r.file.padEnd(40)} (${dur}s)`);
  }
  const passed = results.length - failed.length;
  const totalSec = (totalMs / 1000).toFixed(1);
  console.log(`  ${B}Passed: ${passed}/${results.length}, Failed: ${failed.length}, Duration: ${totalSec}s${X}`);
  if (failed.length > 0) {
    console.log(`  ${R}Failures:${X} ${failed.map(f => f.file).join(", ")}`);
  }
  console.log(`${B}${Y}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${X}\n`);

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("\n💥 run-all error:", err);
  process.exit(1);
});
