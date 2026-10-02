// The behaviors added to close the AXI admission review's gaps (principles 2-7, 9, 10).
// Every test uses a fake `hey`; nothing touches a real HEY account or mailbox.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { makeFakeHey, makeFakeHeyScript, runAxi } from "./helpers.js";
import { loadBundledManifest, listCommands } from "../src/router.js";
import { commandHelp } from "../src/cli.js";
import { examplesFor } from "../src/examples.js";
import { LIST_FIELDS, MAX_LIST_FIELDS, shapeEnvelope } from "../src/shape.js";

const manifest = loadBundledManifest();

async function refusedBeforeHey(lines, pattern) {
  const fake = await makeFakeHey();
  for (const line of lines) {
    const result = await runAxi(line, { fake });
    assert.equal(result.code, 2, `${line.join(" ")}: ${result.stdout}`);
    assert.match(result.stdout, /^ok: false$/m, line.join(" "));
    if (pattern) assert.match(result.stdout, pattern, line.join(" "));
  }
  assert.deepEqual(await fake.calls(), [], "HEY must not run");
  await fake.cleanup();
}

// Principle 2
test("every default list schema has at most four fields", () => {
  for (const [path, fields] of Object.entries(LIST_FIELDS)) assert.ok(fields.length <= MAX_LIST_FIELDS, `${path}: ${fields.length} fields`);
  const wide = [{ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 }];
  const shaped = shapeEnvelope({ ok: true, data: wide }, { path: "unknown list", commandLine: "hey-axi x" });
  assert.deepEqual(Object.keys(shaped.data[0]), ["a", "b", "c", "d"]);
});

// Principles 3-5
test("bare (non-envelope) lists get shaping, a count and a definitive empty state", () => {
  const empty = shapeEnvelope([], { path: "clip list", commandLine: "hey-axi clip list" });
  assert.deepEqual(empty, { count: "0 total", data: [], empty: "0 results for `hey-axi clip list`" });
  const rows = shapeEnvelope([{ id: 1, content: "c".repeat(300), topic_id: 2, created_at: "t", extra: 1 }], { path: "clip list", commandLine: "hey-axi clip list" });
  assert.equal(rows.count, "1 total");
  assert.deepEqual(Object.keys(rows.data[0]), ["id", "content", "topic_id", "at"]);
  assert.deepEqual(rows.help, ["Run `hey-axi clip list --full` to see complete content"]);
  const nothing = shapeEnvelope({ ok: true, data: null }, { path: "timetrack current", commandLine: "hey-axi timetrack current" });
  assert.equal(nothing.empty, "no data returned for `hey-axi timetrack current`");
});

test("counts come from meta.total_count, a 'Showing N of T' notice, or HEY's paging signals", async () => {
  const cases = [
    [{ ok: true, data: [{ id: 1 }] }, /^count: 1 total$/m, null],
    [{ ok: true, data: [{ id: 1 }], meta: { total_count: 30 } }, /^count: 1 of 30 total$/m, /--all` for all 30/],
    [{ ok: true, data: [{ id: 1 }], notice: "Showing 1 of 12 results." }, /^count: 1 of 12 total$/m, /--all` for all 12/],
    [{ ok: true, data: [{ id: 1 }], notice: "Showing 25 results. More available; use --all to fetch all." }, /^count: 1 shown; more available$/m, /--all` for all of them/],
  ];
  for (const [envelope, count, more] of cases) {
    const fake = await makeFakeHey({ stdout: JSON.stringify(envelope) });
    const result = await runAxi(["box", "view", "imbox", "--limit", "1"], { fake });
    assert.match(result.stdout, count, JSON.stringify(envelope));
    if (more) assert.match(result.stdout, more);
    else assert.doesNotMatch(result.stdout, /--all/);
    await fake.cleanup();
  }
  const paged = await makeFakeHey({ stdout: JSON.stringify({ ok: true, data: [{ id: 1 }], meta: { next_page: "cur-2" } }) });
  const history = await runAxi(["screener", "history"], { fake: paged });
  assert.match(history.stdout, /count: 1 shown; more available/);
  assert.match(history.stdout, /Run `hey-axi screener history --all` for all of them/);
  await paged.cleanup();
});

// Principle 6: fail loud
test("flags without a value and values of the wrong type fail before HEY runs", () => refusedBeforeHey([
  ["box", "view", "imbox", "--limit"],
  ["box", "view", "imbox", "--limit", "--json"],
  ["box", "view", "imbox", "--limit", "ten"],
  ["watch", "--timeout", "soon"],
  ["box", "view", "imbox", "--all=maybe"],
  ["--account"],
], /missing value|whole number|duration|is a switch/));

test("missing and extra positional arguments fail before HEY runs, with usage and an example", async () => {
  await refusedBeforeHey([["thread", "read"], ["seen"], ["config", "set", "base_url"]], /missing argument </);
  await refusedBeforeHey([["thread", "read", "1", "2"], ["search", "acme", "invoice"], ["box", "list", "extra"]], /unexpected argument/);
  const fake = await makeFakeHey();
  const result = await runAxi(["search", "acme", "invoice"], { fake });
  assert.match(result.stdout, /quote text that contains spaces/);
  assert.match(result.stdout, /usage: hey-axi search \[query\]/);
  const group = await runAxi(["box"], { fake });
  assert.match(group.stdout, /subcommands\[2\]: list,view/);
  assert.match(group.stdout, /shortcut: hey-axi box <name\|id>/);
  await fake.cleanup();
});

test("one-of flag groups need exactly one flag", async () => {
  await refusedBeforeHey([["bubble", "up", "1"]], /needs one of --now, --on, --tomorrow/);
  await refusedBeforeHey([["bubble", "up", "1", "--now", "--tomorrow"]], /can't be combined/);
  const fake = await makeFakeHey();
  assert.equal((await runAxi(["bubble", "up", "1", "2", "--on", "2026-10-05"], { fake })).code, 0);
  await fake.cleanup();
});

// Principle 6: no interactive prompts
test("content that would open an editor is required up front", async () => {
  await refusedBeforeHey([
    ["compose", "--to", "a@example.com", "--subject", "Hi"],
    ["reply", "1"],
    ["journal", "write", "2026-10-01"],
    ["contact", "note", "set", "7"],
    ["draft", "edit", "77"],
  ], /missing (a message|the entry|the note|a field to change)[\s\S]*would open an editor/);
  const fake = await makeFakeHey({ stdout: '{"ok":true,"data":{"id":1}}' });
  for (const line of [["reply", "1", "--dry-run"], ["journal", "write", "Shipped the release"], ["contact", "note", "set", "7", "met at conf"], ["reply", "1", "--attach", "/tmp/f.pdf"]]) {
    assert.equal((await runAxi(line, { fake })).code, 0, line.join(" "));
  }
  await fake.cleanup();
});

test("--message - reads the message from stdin and passes it as the flag value", async () => {
  const fake = await makeFakeHeyScript(`printf '{"ok":true,"data":{"id":5}}'`);
  const result = await new Promise((done) => {
    const child = execFile(process.execPath, [resolve("src/hey-axi.js"), "reply", "9", "--message", "-"], { env: { ...process.env, HEY_BIN: fake.bin, HEY_AXI_STATE_DIR: join(tmpdir(), "hey-axi-stdin-state") } },
      (error, stdout) => done({ code: error ? error.code : 0, stdout }));
    child.stdin.end("Line one\nLine two");
  });
  assert.equal(result.code, 0, result.stdout);
  assert.match(result.stdout, /saved_as: draft/);
  assert.deepEqual(await fake.calls(), ["reply 9 --message Line one", "Line two --draft --json"]);
  await fake.cleanup();
});

// Principle 6: idempotent mutations
test("mutations whose end state already holds are no-ops with exit 0", async () => {
  const already = await makeFakeHey({ exitCode: 1, stdout: "", stderr: '{"ok":false,"error":"Threads are already seen","code":"conflict"}' });
  const seen = await runAxi(["seen", "12", "13"], { fake: already });
  assert.equal(seen.code, 0, seen.stdout);
  assert.match(seen.stdout, /noop: true/);
  assert.match(seen.stdout, /result: already done for 12 13 \(no-op\)/);
  await already.cleanup();

  const gone = await makeFakeHey({ exitCode: 2, stdout: "", stderr: '{"ok":false,"error":"resource not found","code":"not_found"}' });
  const deleted = await runAxi(["draft", "delete", "77"], { fake: gone });
  assert.equal(deleted.code, 0, deleted.stdout);
  assert.match(deleted.stdout, /nothing to delete: 77 is already gone \(no-op\)/);
  // A read of something missing is still an error.
  const read = await runAxi(["thread", "read", "77"], { fake: gone });
  assert.equal(read.code, 1);
  assert.match(read.stdout, /kind: not_found/);
  await gone.cleanup();
});

// Principle 9
test("suggested commands carry the invocation's --account and --base-url", async () => {
  const envelope = { ok: true, data: [{ id: 1 }], breadcrumbs: [{ command: "hey thread read <thread-id>", description: "Read" }], notice: "More available; use --all" };
  const fake = await makeFakeHey({ stdout: JSON.stringify(envelope) });
  const result = await runAxi(["--account", "5", "box", "view", "imbox", "--base-url", "https://hey.example"], { fake });
  assert.match(result.stdout, /Run `hey-axi thread read <thread-id> --account 5 --base-url https:\/\/hey\.example` to read/);
  assert.match(result.stdout, /Run `hey-axi --account 5 box view imbox --base-url https:\/\/hey\.example --all`/);
  await fake.cleanup();
});

// Principle 10
test("every command's --help lists arguments, a default for every flag, and 2-3 examples", () => {
  for (const node of listCommands(manifest.commands)) {
    const help = commandHelp(node);
    const examples = examplesFor(node);
    assert.ok(examples.length >= 2 && examples.length <= 3, `${node.path}: ${examples.length} examples`);
    for (const flag of node.flags || []) {
      const line = help.split("\n").find((text) => text.startsWith(`  --${flag.name}`));
      assert.ok(line, `${node.path} --${flag.name} missing from help`);
      assert.match(line, /\(default[ :][^)]*\)$/, `${node.path} --${flag.name}: ${line}`);
    }
    if (/<[^>]+>/.test((node.synopsis || []).join(" ").replace(/<command>/g, ""))) assert.match(help, /\narguments:\n/, node.path);
  }
});

// Principle 7: directory scope and session lifecycle capture
const runIn = (cwd, args, env, input) => new Promise((done) => {
  const child = execFile(process.execPath, [resolve("src/hey-axi.js"), ...args], { cwd, env: { ...process.env, ...env } },
    (error, stdout) => done({ code: error ? error.code : 0, stdout }));
  child.stdin.end(input ?? "");
});

test("setup scope writes .hey-axi.json; the home view shows that scope only, with its account carried", async () => {
  const project = await mkdtemp(join(tmpdir(), "hey-axi-scope-"));
  const sub = join(project, "src");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(sub));
  const fake = await makeFakeHey({ stdout: JSON.stringify({ ok: true, data: [{ id: 1, topic_id: 2, name: "Acme renewal", creator: { name: "Ann" } }], meta: { total_count: 14 } }) });
  const env = { HEY_BIN: fake.bin, HEY_AXI_STATE_DIR: join(project, ".state") };
  const wrote = await runIn(project, ["setup", "scope", "--label", "Acme", "--account", "5", "--limit", "3"], env);
  assert.equal(wrote.code, 0, wrote.stdout);
  assert.deepEqual(JSON.parse(await readFile(join(project, ".hey-axi.json"), "utf8")), { label: "Acme", account: "5", limit: 3 });
  assert.match((await runIn(project, ["setup", "scope", "--label", "Acme", "--account", "5", "--limit", "3"], env)).stdout, /already up to date/);
  const home = await runIn(sub, [], env);
  assert.equal(home.code, 0);
  assert.match(home.stdout, /scope: "?label Acme, account 5 \(from .*\.hey-axi\.json\)/);
  assert.match(home.stdout, /count: 1 of 14 total/);
  assert.match(home.stdout, /Run `hey-axi label view Acme --account 5 --all` for all 14/);
  assert.match(home.stdout, /Run `hey-axi thread read <topic_id> --account 5`/);
  assert.deepEqual(await fake.calls(), ["label view Acme --limit 3 --account 5 --json"]);
  assert.match((await runIn(project, ["setup", "scope", "--status"], env)).stdout, /label Acme/);
  assert.match((await runIn(project, ["setup", "scope", "--box", "feed", "--label", "x"], env)).stdout, /use only one of box, label, search/);
  assert.match((await runIn(project, ["setup", "scope", "--remove"], env)).stdout, /removed/);
  assert.match((await runIn(project, ["setup", "scope", "--remove"], env)).stdout, /nothing to remove/);
  await writeFile(join(project, ".hey-axi.json"), '{"labels":"x"}');
  const broken = await runIn(project, [], env);
  assert.equal(broken.code, 0);
  assert.match(broken.stdout, /status: .*unknown key labels/);
  await fake.cleanup();
  await rm(project, { recursive: true, force: true });
});

test("session end hooks capture what hey-axi did; the next home view summarizes it", async () => {
  const home = await mkdtemp(join(tmpdir(), "hey-axi-home-"));
  const project = await mkdtemp(join(tmpdir(), "hey-axi-proj-"));
  const fake = await makeFakeHey({ stdout: '{"ok":true,"data":[{"id":1,"topic_id":2,"name":"Hi"}]}' });
  const env = { HOME: home, HEY_BIN: fake.bin, HEY_AXI_STATE_DIR: join(home, "state"), XDG_STATE_HOME: "" };
  assert.equal((await runIn(project, ["setup", "hooks"], env)).code, 0);
  const claude = JSON.parse(await readFile(join(home, ".claude/settings.json"), "utf8"));
  assert.match(claude.hooks.SessionEnd[0].hooks[0].command, /hey-axi.* hook session-end$/);
  assert.match(JSON.parse(await readFile(join(home, ".codex/hooks.json"), "utf8")).hooks.SessionEnd[0].hooks[0].command, /hook session-end$/);
  assert.ok(existsSync(join(home, ".config/opencode/plugins/axi-hey-axi-session-end.js")));
  assert.match((await runIn(project, ["setup", "hooks", "--status"], env)).stdout, /claude: installed with session end/);

  await runIn(project, ["reply", "2", "--message", "Thanks"], env);
  await runIn(project, ["seen", "1"], env);
  await runIn(project, ["thread", "read", "2"], env);
  const journal = await readFile(join(home, "state", "activity.jsonl"), "utf8");
  assert.doesNotMatch(journal, /Thanks/, "message text is never journaled");
  const ended = await runIn(home, ["hook", "session-end"], env, JSON.stringify({ session_id: "s1", cwd: project }));
  assert.equal(ended.code, 0);
  assert.match(ended.stdout, /captured: 3/);
  const next = await runIn(project, [], env);
  assert.match(next.stdout, /last_session: "?ended .*reply \(saved as draft, not sent\) ×1 \[2\]; seen ×1 \[1\]; thread read ×1 \[2\]/);
  assert.match(next.stdout, /Run `hey-axi draft list` to review drafts saved last session/);
  // A session with no hey-axi activity keeps the previous summary.
  await runIn(project, ["hook", "session-end"], env, "{}");
  assert.match((await runIn(project, [], env)).stdout, /last_session:/);
  // Another directory has its own (empty) history.
  assert.doesNotMatch((await runIn(home, [], env)).stdout, /last_session:/);

  const removed = await runIn(project, ["setup", "hooks", "--remove"], env);
  assert.match(removed.stdout, /hooks: removed/);
  assert.equal(JSON.parse(await readFile(join(home, ".claude/settings.json"), "utf8")).hooks.SessionEnd, undefined);
  assert.ok(!existsSync(join(home, "state", "activity.jsonl")));
  assert.ok(!existsSync(join(home, ".config/opencode/plugins/axi-hey-axi-session-end.js")));
  await fake.cleanup();
  await rm(home, { recursive: true, force: true });
  await rm(project, { recursive: true, force: true });
});

test("without setup hooks nothing is journaled", async () => {
  const state = await mkdtemp(join(tmpdir(), "hey-axi-state-"));
  const fake = await makeFakeHey({ stdout: '{"ok":true,"data":{"id":1}}' });
  await runAxi(["seen", "1"], { fake, env: { HEY_AXI_STATE_DIR: state } });
  assert.ok(!existsSync(join(state, "activity.jsonl")));
  await fake.cleanup();
  await rm(state, { recursive: true, force: true });
});

test("every refusal carries kind: usage, and panics or stack traces never reach the agent", async () => {
  await refusedBeforeHey([["boxx", "list"], ["tui"], ["box", "view"]], /^kind: usage$/m);
  const { cleanLine } = await import("../src/errors.js");
  assert.equal(cleanLine("panic: runtime error: index out of range\ngoroutine 1 [running]:\nmain.go:12"), "");
  assert.equal(cleanLine("\u001b[31mError: no such label\u001b[0m\n    at x (y.js:1)"), "no such label");
});
