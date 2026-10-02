// AXI principles: home view, --version, field selection, truncation, empty states,
// aggregates, fail-loud flags, per-command help, and session hooks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { makeFakeHey, runAxi } from "./helpers.js";
import { VERSION } from "../src/version.js";
import { HOME_LIMIT, homeHelp } from "../src/guide.js";
import { project, shapeData, shapeEnvelope, LIST_TEXT_LIMIT, DETAIL_TEXT_LIMIT } from "../src/shape.js";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const posting = (id, extra = {}) => ({
  id, topic_id: id + 1, name: `Subject ${id}`, summary: "x".repeat(300), seen: false, active_at: "2026-09-01T10:00:00Z",
  app_url: "https://app.hey.example/x", creator: { name: `Sender ${id}`, email_address: `s${id}@example.com`, avatar_url: "https://a" }, ...extra,
});
const imbox = (postings) => JSON.stringify({
  ok: true, summary: `${postings.length} threads in Imbox`,
  data: { id: 7, name: "Imbox", kind: "imbox", url: "https://u", postings },
  breadcrumbs: [{ action: "read", command: "hey thread read <thread-id>", description: "Read an email thread" }],
});

test("-v, -V and --version print the bare version without calling HEY", async () => {
  assert.equal(VERSION, pkg.version);
  const fake = await makeFakeHey();
  for (const flag of ["-v", "-V", "--version"]) {
    const result = await runAxi([flag], { fake });
    assert.equal(result.code, 0);
    assert.equal(result.stdout, `${VERSION}\n`);
  }
  assert.deepEqual(await fake.calls(), []);
  await fake.cleanup();
});

test("the --version fast path stays close to bare node startup", () => {
  const time = (args) => {
    const runs = [];
    for (let i = 0; i < 5; i += 1) {
      const start = process.hrtime.bigint();
      execFileSync(process.execPath, args);
      runs.push(Number(process.hrtime.bigint() - start) / 1e6);
    }
    return runs.sort((a, b) => a - b)[2];
  };
  const floor = time(["-e", "console.log(1)"]);
  const version = time(["src/hey-axi.js", "--version"]);
  assert.ok(version < floor * 2 + 60, `--version took ${version.toFixed(0)}ms vs node floor ${floor.toFixed(0)}ms`);
});

test("`hey-axi version` shows hey-axi's version next to HEY's", async () => {
  const fake = await makeFakeHey({ stdout: '{"ok":true,"data":{"version":"1.7.0","commit":"abc"}}' });
  const result = await runAxi(["version"], { fake });
  assert.equal(result.code, 0);
  assert.match(result.stdout, new RegExp(`hey_axi: "?${VERSION.replace(/\./g, "\\.")}"?`));
  assert.match(result.stdout, /hey: "?1\.7\.0"?/);
  await fake.cleanup();
});

test("no arguments: home view with identity, compact Imbox and next commands", async () => {
  const fake = await makeFakeHey({ stdout: imbox([posting(1), posting(2)]) });
  const result = await runAxi([], { fake });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^bin: .*hey-axi\.js$/m);
  assert.match(result.stdout, /^description: /m);
  assert.match(result.stdout, /^scope: "?account-wide Imbox \(no \.hey-axi\.json here/m);
  assert.match(result.stdout, /^count: 2 (total|shown; no more pages reported)$/m);
  assert.match(result.stdout, /threads\[2\]\{id,topic_id,from,subject\}:/);
  assert.match(result.stdout, /1,2,Sender 1,Subject 1\n/);
  assert.doesNotMatch(result.stdout, /app_url|avatar|xxxxx/);
  for (const line of homeHelp().filter((text) => !text.includes('"'))) assert.ok(result.stdout.includes(line), line);
  assert.deepEqual(await fake.calls(), [`box view imbox --limit ${HOME_LIMIT} --json`]);
  await fake.cleanup();
});

test("home view degrades gracefully: HEY missing, signed out, empty Imbox", async () => {
  const missing = await runAxi([], { env: { HEY_BIN: "/nonexistent/hey" } });
  assert.equal(missing.code, 0);
  assert.match(missing.stdout, /status: .*HEY CLI not found/);
  assert.match(missing.stdout, /install-cli/);

  const signedOut = await makeFakeHey({ exitCode: 3, stdout: "", stderr: '{"ok":false,"error":"Not logged in","code":"auth"}' });
  const auth = await runAxi([], { fake: signedOut });
  assert.equal(auth.code, 0);
  assert.match(auth.stdout, /status: not signed in to HEY/);
  assert.match(auth.stdout, /hey-axi auth login/);
  await signedOut.cleanup();

  const empty = await makeFakeHey({ stdout: imbox([]) });
  const none = await runAxi([], { fake: empty });
  assert.match(none.stdout, /mail: "?0 threads: nothing in account-wide Imbox"?/);
  assert.doesNotMatch(none.stdout, /^count:/m);
  await empty.cleanup();
});

test("lists default to a few fields; --fields picks, --fields all and --full keep everything", async () => {
  const fake = await makeFakeHey({ stdout: imbox([posting(1)]) });
  const plain = await runAxi(["box", "view", "imbox"], { fake });
  assert.match(plain.stdout, /postings\[1\]\{id,topic_id,from,subject\}:/);
  assert.match(plain.stdout, /^count: 1 shown; no more pages reported$/m);
  assert.doesNotMatch(plain.stdout, /app_url|avatar_url|\nurl:/);
  assert.match(plain.stdout, /help\[1\]: Run `hey-axi thread read <thread-id>` to read an email thread/);

  const picked = await runAxi(["box", "view", "imbox", "--fields", "id,from,creator.email_address"], { fake });
  assert.match(picked.stdout, /postings\[1\]\{id,from,"?creator\.email_address"?\}:/);
  assert.match(picked.stdout, /1,Sender 1,s1@example\.com/);

  const all = await runAxi(["box", "view", "imbox", "--fields=all"], { fake });
  assert.match(all.stdout, /avatar_url/);
  assert.match(all.stdout, /x{120}… \(truncated, 300 chars total\)|x{120}/);

  const full = await runAxi(["box", "view", "imbox", "--full"], { fake });
  assert.match(full.stdout, /x{300}/);
  assert.match(full.stdout, /breadcrumbs/);

  const unknown = await runAxi(["box", "view", "imbox", "--fields", "id,nope"], { fake });
  assert.equal(unknown.code, 2);
  assert.match(unknown.stdout, /unknown field nope for `box view`/);
  assert.match(unknown.stdout, /available fields: id, topic_id, from/);

  // --fields and --full are hey-axi's: HEY never sees them.
  for (const call of await fake.calls()) assert.equal(call, "box view imbox --json");
  await fake.cleanup();
});

test("long text is truncated with its size and a --full hint; --full returns it whole", async () => {
  const body = "word ".repeat(600);
  const fake = await makeFakeHey({ stdout: JSON.stringify({ ok: true, data: [{ id: 9, creator: { name: "A", email_address: "a@x" }, body, app_url: "u" }] }) });
  const result = await runAxi(["thread", "read", "5"], { fake });
  assert.match(result.stdout, new RegExp(`… \\(truncated, ${body.length} chars total\\)`));
  assert.match(result.stdout, /Run `hey-axi thread read 5 --full` to see complete content/);
  assert.doesNotMatch(result.stdout, /app_url/);
  const full = await runAxi(["thread", "read", "5", "--full"], { fake });
  assert.ok(full.stdout.includes(body.trim()));
  assert.doesNotMatch(full.stdout, /truncated/);
  await fake.cleanup();
});

test("empty lists say so; known totals become a count", async () => {
  const empty = await makeFakeHey({ stdout: '{"ok":true,"data":[],"summary":"0 labels"}' });
  const none = await runAxi(["label", "list"], { fake: empty });
  assert.equal(none.code, 0);
  assert.match(none.stdout, /empty: 0 results for `hey-axi label list`/);
  await empty.cleanup();

  const totals = await makeFakeHey({ stdout: JSON.stringify({ ok: true, data: [{ id: 1, name: "A", email_address: "a@x", subject: "S", topic_id: 2 }], meta: { total_count: 40, pages_fetched: 1 } }) });
  const count = await runAxi(["screener", "list"], { fake: totals });
  assert.match(count.stdout, /count: 1 of 40 total/);
  assert.doesNotMatch(count.stdout, /pages_fetched/);
  await totals.cleanup();
});

test("unknown and missing-required flags fail before HEY runs (exit 2) and list valid flags", async () => {
  const fake = await makeFakeHey();
  const typo = await runAxi(["box", "list", "--limt", "5"], { fake });
  assert.equal(typo.code, 2);
  assert.match(typo.stdout, /unknown flag --limt for `box list`/);
  assert.match(typo.stdout, /valid flags for `box list`: --all, --limit <int>/);
  const missing = await runAxi(["move", "123"], { fake });
  assert.equal(missing.code, 2);
  assert.match(missing.stdout, /missing required flag --to for `move`/);
  // Globals, shorthands, attached values and --help always pass.
  assert.equal((await runAxi(["--account", "2", "box", "list", "--limit=5", "--stats"], { fake })).code, 0);
  assert.equal((await runAxi(["reply", "1", "-mhi"], { fake })).code, 0);
  assert.equal((await runAxi(["move", "--help"], { fake })).code, 0);
  assert.deepEqual(await fake.calls(), ["--account 2 box list --limit=5 --stats --json", "reply 1 -mhi --draft --json"]);
  await fake.cleanup();
});

test("per-command help has usage, flag descriptions, examples and notes in hey-axi terms", async () => {
  const result = await runAxi(["move", "--help"]);
  assert.match(result.stdout, /usage: hey-axi move <box-item-id>\.\.\. \[flags\]/);
  assert.match(result.stdout, /--to <string>  Destination box name, kind, or ID \(required\) \(default: none\)/);
  assert.match(result.stdout, /examples:\n  hey-axi move 12345 --to feed/);
  assert.match(result.stdout, /notes: Accepts box item IDs from hey-axi box view output/);
  const list = await runAxi(["box", "view", "--help"]);
  assert.match(list.stdout, /default fields: id, topic_id, from, subject  /);
});

const runIn = (cwd, args, env) => new Promise((done) => execFile(process.execPath, [resolve("src/hey-axi.js"), ...args], { cwd, env: { ...process.env, ...env } },
  (error, stdout) => done({ code: error ? error.code : 0, stdout })));

test("setup hooks: explicit, idempotent, reports status, removes only its own hooks", async () => {
  const home = await mkdtemp(join(tmpdir(), "hey-axi-home-"));
  const env = { HOME: home };
  const first = await runIn(home, ["setup", "hooks"], env);
  assert.equal(first.code, 0, first.stdout);
  assert.match(first.stdout, /hooks: installed or updated \(user scope\)/);
  const claude = JSON.parse(await readFile(join(home, ".claude/settings.json"), "utf8"));
  const hook = claude.hooks.SessionStart[0].hooks[0];
  assert.match(hook.command, /hey-axi/);
  assert.equal(hook.type, "command");
  assert.ok(existsSync(join(home, ".codex/hooks.json")));
  assert.match(await readFile(join(home, ".codex/config.toml"), "utf8"), /hooks = true/);
  assert.ok(existsSync(join(home, ".config/opencode/plugins/axi-hey-axi.js")));

  const again = await runIn(home, ["setup", "hooks"], env);
  assert.match(again.stdout, /already up to date/);
  const status = await runIn(home, ["setup", "hooks", "--status"], env);
  assert.match(status.stdout, /claude: installed/);

  const removed = await runIn(home, ["setup", "hooks", "--remove"], env);
  assert.match(removed.stdout, /hooks: removed/);
  assert.match(removed.stdout, /claude: not installed/);
  assert.ok(!existsSync(join(home, ".config/opencode/plugins/axi-hey-axi.js")));

  const bad = await runIn(home, ["setup", "hooks", "--global"], env);
  assert.equal(bad.code, 2);
  assert.match(bad.stdout, /unknown flag --global/);
  await rm(home, { recursive: true, force: true });
});

test("setup hooks --project writes into the current directory only", async () => {
  const home = await mkdtemp(join(tmpdir(), "hey-axi-home-"));
  const project = await mkdtemp(join(tmpdir(), "hey-axi-proj-"));
  const result = await runIn(project, ["setup", "hooks", "--project"], { HOME: home });
  assert.equal(result.code, 0, result.stdout);
  assert.ok(existsSync(join(project, ".claude/settings.json")));
  assert.ok(existsSync(join(project, ".opencode/plugins/axi-hey-axi.js")));
  assert.ok(!existsSync(join(home, ".claude/settings.json")));
  await rm(home, { recursive: true, force: true });
  await rm(project, { recursive: true, force: true });
});

test("HEY's non-interactive `setup` commands run captured, with no prompts", async () => {
  const fake = await makeFakeHey({ stdout: '{"ok":true,"data":{"plugin_installed":true,"agent_detected":true}}' });
  const result = await runAxi(["setup", "claude"], { fake });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /plugin_installed: true/);
  const text = await makeFakeHey({ stdout: "setup ran\n" });
  const plain = await runAxi(["setup", "omarchy"], { fake: text });
  assert.match(plain.stdout, /output: setup ran/);
  assert.deepEqual([...await fake.calls(), ...await text.calls()], ["setup claude --json", "setup omarchy --json"]);
  await fake.cleanup();
  await text.cleanup();
});

test("shape helpers: projection, fallbacks, array mapping, cell truncation", () => {
  const items = [{ id: 1, creator: { name: "A" }, recipients: { to: [{ email_address: "x@a" }, { email_address: "y@a" }] } }, { id: 2, sender: { name: "B" } }];
  const { rows } = project(items, ["id", "from=creator.name|sender.name", "to=recipients.to[].email_address", "missing"]);
  assert.deepEqual(rows, [{ id: 1, from: "A", to: "x@a, y@a" }, { id: 2, from: "B", to: null }]);
  const shaped = shapeData([{ id: 1, name: "L", content: "c".repeat(500) }], { path: "snippet list" });
  assert.equal(shaped.truncated, true);
  assert.match(shaped.data[0].content, new RegExp(`^c{${LIST_TEXT_LIMIT}}… \\(500 chars\\)$`));
  const detail = shapeData({ id: 1, body: "b".repeat(DETAIL_TEXT_LIMIT + 1) }, { path: "draft show" });
  assert.match(detail.data.body, /truncated, 1001 chars total/);
  const bare = shapeEnvelope({ authenticated: true }, { path: "auth status", commandLine: "hey-axi auth status" });
  assert.deepEqual(bare, { authenticated: true });
});
