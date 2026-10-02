#!/usr/bin/env node
// Capture HEY CLI output for the token benchmark.
//
//   npm run bench:capture                 # SYNTHETIC: real `hey` binary vs a local mock API
//   npm run bench:capture -- --real       # YOUR account, read-only commands only
//
// Synthetic mode needs a `hey` binary (HEY_BIN or PATH) but no login. It points hey at
// bench/lib/mock-hey-api.mjs (HEY_BASE_URL + a dummy HEY_TOKEN, with a throwaway HOME),
// so no real account or mailbox is involved. Output: bench/captures/synthetic/.
//
// Real mode uses your normal HEY login and runs ONLY the read-only commands in
// bench/commands.mjs (box list/view, thread read, label list, screener list, event week,
// todo list, search). Nothing is sent, moved, or marked seen. Output goes to
// bench/captures/real/, which is gitignored: it contains your email, so don't commit it.
// Optional: BENCH_THREAD_ID (defaults to the first Imbox thread), BENCH_SEARCH_QUERY.

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { READ_ONLY_PATHS, benchCommands } from "./commands.mjs";
import { startMockHeyApi } from "./lib/mock-hey-api.mjs";

const real = process.argv.includes("--real");
const HEY = process.env.HEY_BIN || "hey";
const outDir = fileURLToPath(new URL(`./captures/${real ? "real" : "synthetic"}/`, import.meta.url));

// Async on purpose: in synthetic mode the mock API server runs in this same process.
function runHey(argv, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(HEY, argv, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(new Error(`could not run ${HEY}: ${error.message}`)); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ exit_code: code, stdout, stderr }); });
  });
}

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

let mock;
let home;
let env = { ...process.env };
if (!real) {
  mock = await startMockHeyApi({ notFound: ["/topics/999999"] });
  home = mkdtempSync(join(tmpdir(), "hey-bench-home-"));
  env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), HEY_BASE_URL: mock.url, HEY_TOKEN: "synthetic-benchmark-token", HEY_NO_KEYRING: "1", HEY_NONINTERACTIVE: "1" };
  delete env.HEY_ACCOUNT_ID;
}

try {
  let threadId = process.env.BENCH_THREAD_ID;
  if (real && !threadId) {
    const imbox = await runHey(["box", "view", "imbox", "--json", "--quiet"], env);
    const postings = JSON.parse(imbox.stdout || "{}");
    const list = Array.isArray(postings) ? postings : postings.postings || [];
    threadId = list[0]?.topic_id || list[0]?.id;
    if (!threadId) throw new Error("couldn't find a thread in the Imbox; set BENCH_THREAD_ID");
  }
  const commands = benchCommands({ threadId: threadId || "50000", searchQuery: process.env.BENCH_SEARCH_QUERY || "invoice" });
  mkdirSync(outDir, { recursive: true });
  const version = await runHey(["version", "--json", "--quiet"], env);
  for (const command of commands) {
    if (!READ_ONLY_PATHS.has(command.path)) throw new Error(`refusing non-read-only command: ${command.path}`);
    const json = await runHey([...command.argv, "--json"], env);
    const styled = await runHey([...command.argv, "--styled"], env);
    const capture = {
      synthetic: !real,
      command: command.name,
      argv: command.argv,
      hey_version: JSON.parse(version.stdout || "{}").version,
      json: { exit_code: json.exit_code, stdout: json.stdout, stderr: json.stderr },
      styled: { exit_code: styled.exit_code, stdout: styled.stdout, stderr: styled.stderr },
    };
    writeFileSync(join(outDir, `${slug(command.name)}.json`), `${JSON.stringify(capture, null, 1)}\n`);
    process.stdout.write(`captured ${command.name} (exit ${json.exit_code})\n`);
  }
} finally {
  if (mock) await mock.close();
  if (home) rmSync(home, { recursive: true, force: true });
}
