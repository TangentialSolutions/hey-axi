// Shared test helpers: a fake `hey` binary that records its argv and replies with
// canned output, so no test ever touches the real HEY CLI or a mailbox.

import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

// options: stdout, stderr, exitCode, catalog (array served for `hey commands`)
export async function makeFakeHey(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "hey-axi-fake-"));
  const bin = join(directory, "hey");
  const log = join(directory, "calls");
  const catalogFile = join(directory, "catalog.json");
  const stdoutFile = join(directory, "stdout");
  const stderrFile = join(directory, "stderr");
  await writeFile(catalogFile, JSON.stringify({ ok: true, data: options.catalog || [] }));
  await writeFile(stdoutFile, options.stdout ?? '{"ok":true,"data":[]}');
  await writeFile(stderrFile, options.stderr ?? "");
  await writeFile(bin, `#!/bin/sh
printf '%s\\n' "$*" >> ${shellQuote(log)}
if [ "$1" = "commands" ] && [ -n "${options.catalog ? "1" : ""}" ]; then cat ${shellQuote(catalogFile)}; exit 0; fi
cat ${shellQuote(stdoutFile)}
cat ${shellQuote(stderrFile)} >&2
exit ${Number(options.exitCode || 0)}
`);
  await chmod(bin, 0o755);
  return {
    bin,
    async calls() {
      try {
        return (await readFile(log, "utf8")).split("\n").filter(Boolean);
      } catch {
        return [];
      }
    },
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

// Session capture state goes to a throwaway directory, never the real ~/.local/state.
const STATE_DIR = join(tmpdir(), `hey-axi-test-state-${process.pid}`);

export function runAxi(args, { env = {}, fake, cwd } = {}) {
  // Tests may themselves run inside an agent session: don't inherit its session id.
  const inherited = { ...process.env };
  for (const name of ["HEY_AXI_SESSION_ID", "CLAUDE_CODE_SESSION_ID", "CODEX_THREAD_ID", "CODEX_SESSION_ID", "OPENCODE_SESSION_ID"]) delete inherited[name];
  const fullEnv = { ...inherited, HEY_AXI_STATE_DIR: STATE_DIR, ...env };
  if (fake) fullEnv.HEY_BIN = fake.bin;
  return new Promise((resolve) => execFile(process.execPath, [join(ROOT, "src/hey-axi.js"), ...args], { env: fullEnv, cwd: cwd || ROOT },
    (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr })));
}

// A fake `hey` with an arbitrary shell body (for streaming/signal tests). Calls are logged.
export async function makeFakeHeyScript(body) {
  const directory = await mkdtemp(join(tmpdir(), "hey-axi-fake-"));
  const bin = join(directory, "hey");
  const log = join(directory, "calls");
  await writeFile(bin, `#!/bin/sh
printf '%s\\n' "$*" >> ${shellQuote(log)}
${body}
`);
  await chmod(bin, 0o755);
  return {
    bin,
    async calls() {
      try {
        return (await readFile(log, "utf8")).split("\n").filter(Boolean);
      } catch {
        return [];
      }
    },
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}
