// The OpenCode plugins `hey-axi setup hooks` installs must load on OpenCode 1 and 2:
// one default export with an `id`, `setup(ctx)` (OpenCode 2) and `server(input)` (OpenCode 1).
// The session-start plugin comes from axi-sdk-js (0.1.13 made it OpenCode 2-ready); the
// session-end plugin is hey-axi's own and follows the same shape.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openCodeEndPlugin } from "../src/hooks.js";

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitForFile(path, ms = 3000) {
  for (let waited = 0; waited < ms; waited += 50) {
    if (existsSync(path) && readFileSync(path, "utf8").trim()) return readFileSync(path, "utf8");
    await sleep(50);
  }
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

// The session-end plugin, pointed at a fake hey-axi that records its stdin.
async function loadEndPlugin(dir, name) {
  const record = join(dir, `${name}.jsonl`);
  const fake = join(dir, `fake-hey-axi-${name}`);
  writeFileSync(fake, `#!/bin/sh\n[ "$1 $2" = "hook session-end" ] || exit 9\ncat >> '${record}'\necho >> '${record}'\n`);
  chmodSync(fake, 0o755);
  const file = join(dir, `${name}.mjs`);
  writeFileSync(file, openCodeEndPlugin(fake));
  const plugin = (await import(pathToFileURL(file).href)).default;
  return { plugin, record };
}

test("the session-end plugin is one default export both OpenCode generations load", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hey-axi-oc-"));
  const { plugin } = await loadEndPlugin(dir, "shape");
  assert.equal(plugin.id, "axi-hey-axi-session-end");
  assert.equal(typeof plugin.setup, "function");
  assert.equal(typeof plugin.server, "function");
  rmSync(dir, { recursive: true, force: true });
});

test("OpenCode 1: the event hook records a session that went idle, and ignores other events", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hey-axi-oc-"));
  const { plugin, record } = await loadEndPlugin(dir, "v1");
  const hooks = await plugin.server({ directory: dir });
  await hooks.event({ event: { type: "message.updated", properties: { sessionID: "nope" } } });
  await hooks.event({ event: { type: "session.idle", properties: { sessionID: "ses_1" } } });
  assert.deepEqual(JSON.parse(readFileSync(record, "utf8").trim()), { session_id: "ses_1", cwd: dir });
  rmSync(dir, { recursive: true, force: true });
});

test("OpenCode 2: setup subscribes to the event stream and returns a cleanup that stops it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hey-axi-oc-"));
  const { plugin, record } = await loadEndPlugin(dir, "v2");
  let aborted = false;
  const ctx = {
    location: { directory: dir },
    event: {
      async *subscribe({ signal }) {
        signal.addEventListener("abort", () => { aborted = true; });
        yield { type: "session.status", properties: { sessionID: "ses_2", status: { type: "busy" } } };
        yield { type: "session.deleted", properties: { info: { id: "ses_2", directory: dir } } };
        while (!signal.aborted) await sleep(20);
      },
    },
  };
  const cleanup = plugin.setup(ctx);
  assert.equal(typeof cleanup, "function");
  const text = await waitForFile(record);
  assert.deepEqual(JSON.parse(text.trim()), { session_id: "ses_2", cwd: dir });
  cleanup();
  await sleep(60);
  assert.equal(aborted, true);
  rmSync(dir, { recursive: true, force: true });
});

test("setup hooks installs OpenCode plugins in the OpenCode 2 shape (axi-sdk-js 0.1.13 start plugin + hey-axi end plugin)", async () => {
  const home = mkdtempSync(join(tmpdir(), "hey-axi-home-"));
  const result = await new Promise((done) => execFile(process.execPath, [resolve("src/hey-axi.js"), "setup", "hooks"], { cwd: home, env: { ...process.env, HOME: home, HEY_AXI_STATE_DIR: join(home, "state") } },
    (error, stdout) => done({ code: error ? error.code : 0, stdout })));
  assert.equal(result.code, 0, result.stdout);
  const start = readFileSync(join(home, ".config/opencode/plugins/axi-hey-axi.js"), "utf8");
  assert.match(start, /export default \{\n {2}id: "axi-hey-axi",/);
  assert.match(start, /async setup\(ctx\)/);
  assert.match(start, /async server\(\{ directory \}\)/);
  const end = readFileSync(join(home, ".config/opencode/plugins/axi-hey-axi-session-end.js"), "utf8");
  assert.match(end, /export default \{\n {2}id: "axi-hey-axi-session-end",/);
  assert.doesNotMatch(end, /export const HeyAxiSessionEndPlugin/);
  rmSync(home, { recursive: true, force: true });
});

test("re-running setup hooks upgrades a 0.3.1 (OpenCode 1-only) session-end plugin in place", async () => {
  const home = mkdtempSync(join(tmpdir(), "hey-axi-home-"));
  const run = () => new Promise((done) => execFile(process.execPath, [resolve("src/hey-axi.js"), "setup", "hooks"], { cwd: home, env: { ...process.env, HOME: home, HEY_AXI_STATE_DIR: join(home, "state") } },
    (error, stdout) => done({ code: error ? error.code : 0, stdout })));
  assert.equal((await run()).code, 0);
  const path = join(home, ".config/opencode/plugins/axi-hey-axi-session-end.js");
  writeFileSync(path, "// hey-axi managed opencode session-end plugin\nexport const HeyAxiSessionEndPlugin = async () => ({});\n");
  const again = await run();
  assert.match(again.stdout, /installed or updated/);
  assert.match(readFileSync(path, "utf8"), /export default \{/);
  rmSync(home, { recursive: true, force: true });
});
