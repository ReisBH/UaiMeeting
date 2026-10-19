#!/usr/bin/env node
/**
 * Example: import Granola meetings into a running UaiMeeting server.
 *
 * This is the glue between Granola and UaiMeeting. It does NOT talk to Granola
 * directly - the Granola connector is an MCP server available inside a Claude
 * session, not a public API, and we don't reverse-engineer the app. Instead,
 * you obtain meeting JSON through official means (export it, or have a Claude
 * session fetch it via the Granola connector and save it), then this script
 * POSTs that JSON - in the connector's own shape - to POST /import/granola.
 *
 * Usage:
 *   # 1) start the server in another terminal:  npm start
 *   # 2) import the bundled synthetic samples:
 *   node examples/import-from-granola.mjs examples/sample-granola
 *
 *   node examples/import-from-granola.mjs file1.json dir/           # files and/or dirs
 *   cat meeting.json | node examples/import-from-granola.mjs        # or pipe via stdin
 *   node examples/import-from-granola.mjs --url=http://host:3000 --no-enhance sample.json
 *
 * Flags:
 *   --url=<base>    UaiMeeting base URL (default http://localhost:3000, or $UAIMEETING_URL)
 *   --no-enhance    import keeping Granola's original summary (adds ?enhance=false)
 *   --help          show this help
 *
 * Each input file may be a single meeting, a bare array, or { "meetings": [...] };
 * the server accepts all three. Exits non-zero if any import fails.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const HELP = `import-from-granola — POST Granola-shaped JSON to UaiMeeting

  node examples/import-from-granola.mjs [--url=<base>] [--no-enhance] <file|dir>...
  cat meeting.json | node examples/import-from-granola.mjs

Start the server first (npm start), then run this against the samples:
  node examples/import-from-granola.mjs examples/sample-granola`;

function parseArgs(argv) {
  const paths = [];
  let url = process.env.UAIMEETING_URL ?? "http://localhost:3000";
  let enhance = true;
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") return { help: true };
    else if (arg === "--no-enhance") enhance = false;
    else if (arg.startsWith("--url=")) url = arg.slice("--url=".length);
    else if (arg.startsWith("--")) throw new Error(`unknown flag: ${arg}`);
    else paths.push(arg);
  }
  return { paths, url: url.replace(/\/$/, ""), enhance };
}

/** Expand file/dir paths into a flat list of .json file paths. */
async function collectFiles(paths) {
  const files = [];
  for (const p of paths) {
    const info = await stat(p);
    if (info.isDirectory()) {
      const entries = await readdir(p);
      for (const e of entries.sort()) {
        if (e.endsWith(".json")) files.push(path.join(p, e));
      }
    } else {
      files.push(p);
    }
  }
  return files;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

async function importPayload(endpoint, label, payload) {
  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new Error(
      `não consegui conectar em ${endpoint} (o servidor está rodando? "npm start"): ${err.message}`,
    );
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${label}: HTTP ${res.status} — ${body.error ?? "erro desconhecido"}`);
  }
  return body;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }

  const endpoint = `${args.url}/import/granola${args.enhance ? "" : "?enhance=false"}`;

  // Build the list of (label, payload) pairs from files or stdin.
  const jobs = [];
  if (args.paths.length > 0) {
    const files = await collectFiles(args.paths);
    if (files.length === 0) throw new Error("nenhum arquivo .json encontrado nos caminhos dados");
    for (const f of files) {
      jobs.push({ label: f, payload: JSON.parse(await readFile(f, "utf8")) });
    }
  } else {
    if (process.stdin.isTTY) throw new Error("nada para importar — passe arquivos/pastas ou use um pipe");
    jobs.push({ label: "<stdin>", payload: JSON.parse(await readStdin()) });
  }

  console.log(`→ importando ${jobs.length} arquivo(s) em ${endpoint}\n`);

  let imported = 0;
  let failed = 0;
  for (const { label, payload } of jobs) {
    try {
      const result = await importPayload(endpoint, label, payload);
      imported += result.imported ?? 0;
      console.log(`✓ ${label}: ${result.imported} reunião(ões)`);
      for (const m of result.meetings ?? []) {
        console.log(`    · ${m.title}  [${m.id}]  (${m.provider})`);
      }
    } catch (err) {
      failed += 1;
      console.error(`✗ ${err.message}`);
    }
  }

  console.log(`\nConcluído: ${imported} reunião(ões) importada(s), ${failed} arquivo(s) com falha.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Falhou:", err.message);
  process.exitCode = 1;
});
