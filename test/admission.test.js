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
  assert.deepEqual(empty, { count: "0 shown; no more pages reported", data: [], empty: "0 results for `hey-axi clip list`" });
  const rows = shapeEnvelope([{ id: 1, content: "c".repeat(300), topic_id: 2, created_at: "t", extra: 1 }], { path: "clip list", commandLine: "hey-axi clip list" });
  assert.equal(rows.count, "1 shown; no more pages reported");
  assert.deepEqual(Object.keys(rows.data[0]), ["id", "topic_id", "at"]);
  assert.deepEqual(rows.help, ["Run `hey-axi clip list --fields id,content` to include each clip's content"]);
  const nothing = shapeEnvelope({ ok: true, data: null }, { path: "timetrack current", commandLine: "hey-axi timetrack current" });
  assert.equal(nothing.empty, "no data returned for `hey-axi timetrack current`");
});

test("counts come from meta.total_count, a 'Showing N of T' notice, or HEY's paging signals", async () => {
  const cases = [
    [{ ok: true, data: [{ id: 1 }] }, /^count: 1 shown; no more pages reported$/m, null],
    [{ ok: true, data: [{ id: 1 }], meta: { has_more: false } }, /^count: 1 total$/m, null],
    [{ ok: true, data: { postings: [{ id: 1 }], total_count: 40, next_page: "c2" } }, /^count: 1 of 40 total$/m, /--all` for all 40/],
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

test("only a command's own end state becomes a no-op; other conflicts and sends stay errors", async () => {
  const cases = [
    [["thread", "read", "9"], '{"ok":false,"error":"Edit conflict","code":"conflict"}', 1],
    [["reply", "9", "--message", "hi"], '{"ok":false,"error":"Cannot reply: account is already suspended","code":"forbidden"}', 1],
    [["seen", "9"], '{"ok":false,"error":"Conflict","code":"conflict"}', 1],
    [["todo", "complete", "9"], '{"ok":false,"error":"Todo is already completed","code":"conflict"}', 0],
  ];
  for (const [args, stderr, code] of cases) {
    const fake = await makeFakeHey({ exitCode: 1, stdout: "", stderr });
    const result = await runAxi(args, { fake });
    assert.equal(result.code, code, `${args.join(" ")}: ${result.stdout}`);
    if (code) assert.doesNotMatch(result.stdout, /noop/);
    else assert.match(result.stdout, /noop: true/);
    await fake.cleanup();
  }
});

test("switches take no value, and every letter of stacked shorthands is checked", () => refusedBeforeHey([
  ["reply", "9", "--message", "hi", "--draft=false"],
  ["forward", "9", "--to", "a@b.c", "--allow-send=false"],
  ["box", "view", "imbox", "--all=true"],
  ["box", "view", "imbox", "-vZ"],
]));

test("HEY's error envelope is translated too: no stack traces, no debug meta, no raw output on failure", async () => {
  const stderr = JSON.stringify({ ok: false, error: "Error: boom\n    at handler (server.js:10)\ngoroutine 7 [running]:", code: "api_error", meta: { request_id: "r1", stack: "main.go:12\nmain.go:40", detail: "line one\nmain.go:9" } });
  const fake = await makeFakeHey({ exitCode: 7, stdout: "", stderr });
  const result = await runAxi(["thread", "read", "9"], { fake });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /^error: boom$/m);
  assert.match(result.stdout, /request_id: r1/);
  assert.doesNotMatch(result.stdout, /goroutine|server\.js|main\.go|stack/);
  await fake.cleanup();

  const partial = await makeFakeHeyScript(`printf '101\\n102\\n'; echo "panic: lost connection" >&2; exit 6`);
  const raw = await runAxi(["box", "view", "imbox", "--ids-only"], { fake: partial });
  assert.equal(raw.code, 1);
  assert.match(raw.stdout, /^ok: false$/m);
  assert.match(raw.stdout, /kind: network/);
  assert.doesNotMatch(raw.stdout, /101|panic/);
  await partial.cleanup();
});

test("plain-value lists and multi-list containers get counts, empty states and minimal fields", () => {
  const plain = shapeEnvelope({ ok: true, data: ["a", "b"] }, { path: "label list", commandLine: "hey-axi x" });
  assert.equal(plain.count, "2 shown; no more pages reported");
  const none = shapeEnvelope({ ok: true, data: [] }, { path: "label list", commandLine: "hey-axi x" });
  assert.equal(none.empty, "0 results for `hey-axi x`");
  const row = { id: 1, name: "n", title: "t", status: "s", extra1: 1, extra2: 2 };
  const multi = shapeEnvelope({ ok: true, data: { todos: [row, row], habits: [row] } }, { path: "x", commandLine: "hey-axi x" });
  assert.equal(multi.count, "2 todos, 1 habits");
  assert.ok(Object.keys(multi.data.todos[0]).length <= MAX_LIST_FIELDS);
  const empty = shapeEnvelope({ ok: true, data: { todos: [], habits: [] } }, { path: "x", commandLine: "hey-axi x" });
  assert.equal(empty.empty, "0 results for `hey-axi x`");
});

test("string breadcrumbs, notices and error help carry --account too", async () => {
  const envelope = { ok: true, data: [{ id: 1 }], breadcrumbs: ["Run `hey thread read <topic_id>` to read one"] };
  const fake = await makeFakeHey({ stdout: JSON.stringify(envelope) });
  const result = await runAxi(["box", "view", "imbox", "--account", "5"], { fake });
  assert.match(result.stdout, /`hey-axi thread read <topic_id> --account 5`/);
  await fake.cleanup();
  const missing = await makeFakeHey({ exitCode: 2, stdout: "", stderr: '{"ok":false,"error":"not found","code":"not_found"}' });
  const failed = await runAxi(["thread", "read", "9", "--account", "5"], { fake: missing });
  assert.match(failed.stdout, /`hey-axi box view imbox --account 5`/);
  await missing.cleanup();
});

test("person-only commands never run without --interactive, terminal or not", async () => {
  const { userOnly, runMode } = await import("../src/policy.js");
  const tty = { stdin: true, stdout: true };
  assert.match(userOnly("tui", new Set(), tty).error, /needs the user/);
  assert.equal(userOnly("tui", new Set(["--interactive"]), tty), null);
  assert.match(userOnly("tui", new Set(["--interactive"]), { stdin: false, stdout: false }).reason, /needs a terminal/);
  assert.equal(userOnly("mcp", new Set(["--interactive"]), { stdin: false, stdout: false }), null);
  assert.equal(userOnly("auth login", new Set(["--token"]), { stdin: false, stdout: false }), null);
  assert.match(userOnly("box list", new Set(["--interactive"]), tty).error, /does not apply/);
  assert.equal(runMode("tui", new Set()), "json");
  assert.equal(runMode("tui", new Set(["--interactive"])), "interactive");
});

test("session capture keeps concurrent sessions apart and the summary short", async () => {
  const state = await mkdtemp(join(tmpdir(), "hey-axi-state-"));
  const saved = { ...process.env };
  process.env.HEY_AXI_STATE_DIR = state;
  try {
    const activity = await import("../src/activity.js");
    activity.enableCapture();
    process.env.HEY_AXI_SESSION_ID = "a";
    activity.recordActivity({ path: "seen", positionals: ["1"], scopeDir: "/p" });
    process.env.HEY_AXI_SESSION_ID = "b";
    for (let i = 0; i < 60; i += 1) activity.recordActivity({ path: `label add ${i}`, positionals: [String(i)], scopeDir: "/p" });
    assert.deepEqual(activity.endSession("/p", "a"), { captured: 1 });
    assert.match(activity.lastSession("/p").line, /seen ×1 \[1\]$/);
    assert.deepEqual(activity.endSession("/p", "b"), { captured: 60 });
    assert.ok(activity.lastSession("/p").line.length < 400);
  } finally {
    process.env = saved;
    await rm(state, { recursive: true, force: true });
  }
});

test("the home view's bin is absolute with ~ for the home directory; long text output offers --full", async () => {
  const { collapse } = await import("../src/home-path.js");
  assert.equal(collapse("src/hey-axi.js", "/nowhere"), resolve("src/hey-axi.js"));
  assert.equal(collapse("/home/me/bin/hey-axi", "/home/me"), "~/bin/hey-axi");
  assert.equal(collapse("/home/meg/bin/hey-axi", "/home/me"), "/home/meg/bin/hey-axi");
  const fake = await makeFakeHey({ stdout: "x".repeat(1500) });
  const result = await runAxi(["config", "show"], { fake });
  assert.match(result.stdout, /truncated, 1500 chars total/);
  assert.match(result.stdout, /Run `hey-axi config show --full`/);
  const full = await runAxi(["config", "show", "--full"], { fake });
  assert.match(full.stdout, /x{1500}/);
  await fake.cleanup();
});

test("a HEY killed by a signal is a failure, not a success", async () => {
  const { translateFailure } = await import("../src/errors.js");
  const { exitCode, failure } = translateFailure({ status: null, signal: "SIGKILL", stdout: "", stderr: "" });
  assert.notEqual(exitCode, 0);
  assert.equal(failure.ok, false);
  const killed = await makeFakeHeyScript("kill -9 $$");
  const result = await runAxi(["thread", "read", "9"], { fake: killed });
  assert.equal(result.code, 1, result.stdout);
  assert.match(result.stdout, /^ok: false$/m);
  await killed.cleanup();
});

test("hey-axi's own setup commands refuse values on switches", async () => {
  const removed = await runAxi(["setup", "hooks", "--remove=false"]);
  assert.equal(removed.code, 2);
  assert.match(removed.stdout, /--remove is a switch/);
  const scope = await runAxi(["setup", "scope", "--status=no"]);
  assert.equal(scope.code, 2);
  assert.match(scope.stdout, /--status is a switch/);
});

test("move is a no-op only when HEY names the requested destination; creates stay errors", async () => {
  const { noopFor } = await import("../src/policy.js");
  assert.equal(noopFor("move", { error: "Already in another box; cannot move", kind: "command_error" }, ["5"], { to: "feed" }), null);
  assert.equal(noopFor("move", { error: "Thread is already in the Feed", kind: "command_error" }, ["5"], { to: "feed" }).noop, true);
  assert.equal(noopFor("label create", { error: "Name has already been taken", code: "conflict", kind: "command_error" }, ["Acme"]), null);
});

test("person-only commands' examples include --interactive", () => {
  for (const path of ["tui", "mcp", "setup"]) {
    const node = listCommands(manifest.commands).find((candidate) => candidate.path === path);
    for (const example of examplesFor(node)) assert.match(example, /--interactive|--token|--cookie/, `${path}: ${example}`);
  }
});

test("content next to a list is kept; multi-list totals and paging are reported", () => {
  const detail = shapeEnvelope({ ok: true, data: { message: { body: "b".repeat(1200) }, attachments: [{ id: 1 }] } }, { path: "x", commandLine: "hey-axi x" });
  assert.match(detail.data.message.body, /truncated, 1200 chars total/);
  const multi = shapeEnvelope({ ok: true, data: { todos: [{ id: 1 }], habits: [{ id: 2 }] }, meta: { total_count: 100, has_more: true } }, { path: "x", commandLine: "hey-axi x", pageFlags: ["all"] });
  assert.equal(multi.count, "1 todos, 1 habits (100 total)");
  assert.ok(multi.help.some((line) => /--all` for all 100/.test(line)));
});

test("the home view never calls an empty page 'nothing' when HEY reports more", async () => {
  const fake = await makeFakeHey({ stdout: JSON.stringify({ ok: true, data: { postings: [], total_count: 12, next_page: "c2" } }) });
  const result = await runAxi([], { fake });
  assert.doesNotMatch(result.stdout, /nothing in/);
  assert.match(result.stdout, /0 threads on this page; HEY reports 12 in total/);
  await fake.cleanup();
});

test("local refusals carry --account into their suggestions", async () => {
  const fake = await makeFakeHey();
  const blocked = await runAxi(["forward", "9", "--to", "a@b.c", "--account", "5"], { fake });
  assert.equal(blocked.code, 2);
  assert.match(blocked.stdout, /hey-axi reply [^`]*--account 5/);
  assert.deepEqual(await fake.calls(), []);
  await fake.cleanup();
});

test("a delete is a no-op only when the missing thing is the target", async () => {
  const { noopFor } = await import("../src/policy.js");
  assert.equal(noopFor("todo delete", { kind: "not_found", error: "calendar not found" }, ["42"]), null);
  assert.equal(noopFor("todo delete", { kind: "not_found", error: "Todo not found" }, ["42"]).noop, true);
  assert.equal(noopFor("todo delete", { kind: "not_found", error: "resource not found" }, ["42"]).noop, true);
});

test("an empty page is not 'nothing' when HEY reports more", () => {
  const out = shapeEnvelope({ ok: true, data: [], meta: { total_count: 42 } }, { path: "x", commandLine: "hey-axi x" });
  assert.equal(out.count, "0 of 42 total");
  assert.equal(out.empty, "0 results on this page for `hey-axi x`; HEY reports 42 in total");
});

test("hey-axi's own commands have help and validate flags before it", async () => {
  const hook = await runAxi(["hook", "session-end", "--help"]);
  assert.equal(hook.code, 0);
  assert.match(hook.stdout, /usage: hey-axi hook session-end/);
  const scope = await runAxi(["setup", "scope", "--help", "--bogus"]);
  assert.equal(scope.code, 2);
  assert.match(scope.stdout, /unknown flag --bogus/);
  const top = await runAxi(["--help", "--bogus"]);
  assert.equal(top.code, 2);
  const redirected = await runAxi(["--help", "move"]);
  assert.match(redirected.stdout, /^hey-axi move — /);
});

test("a list with no next steps from HEY still gets one", async () => {
  const fake = await makeFakeHey({ stdout: JSON.stringify({ ok: true, data: [{ id: 1, name: "Acme" }] }) });
  const labels = await runAxi(["label", "list", "--account", "5"], { fake });
  assert.match(labels.stdout, /Run `hey-axi label view <id> --account 5` to see one in full/);
  await fake.cleanup();
});

test("fourth review: partial failures, multi-list fields, selector forms, empty-list next steps", async () => {
  const { noopFor } = await import("../src/policy.js");
  assert.equal(noopFor("seen", { error: "Item 1 already seen; item 2 failed", kind: "command_error" }, ["1", "2"]), null);
  assert.equal(noopFor("label add", { error: "Already in label Other; cannot add to Requested", kind: "command_error" }, ["1"]), null);
  assert.throws(() => shapeEnvelope({ ok: true, data: { todos: [{ id: 1 }], habits: [{ id: 2 }] } }, { path: "x", fields: ["typo"], commandLine: "hey-axi x" }), /unknown field/);
  const { carrySelectors } = await import("../src/shape.js");
  assert.equal(carrySelectors("Run hey-axi auth login", ["--account", "5"]), "Run hey-axi auth login --account 5");
  assert.equal(carrySelectors('Run `hey-axi search "<query>"` to search', ["--account", "5"]), 'Run `hey-axi search "<query>" --account 5` to search');
  const fake = await makeFakeHey({ stdout: JSON.stringify({ ok: true, data: [] }) });
  const labels = await runAxi(["label", "list"], { fake });
  assert.match(labels.stdout, /hey-axi label create --help/);
  await fake.cleanup();
});

test("0.3.0 edge cases: container and batch no-ops, page hints, scope quoting, nested plain lists, setup defaults, error cleaning", async () => {
  const { noopFor } = await import("../src/policy.js");
  assert.equal(noopFor("label add", { error: "Already in label Other", kind: "command_error" }, ["1"], { to: "Requested" }), null);
  assert.equal(noopFor("label add", { error: "Thread is already labeled", kind: "command_error" }, ["1"], { to: "7" }).noop, true);
  assert.equal(noopFor("seen", { error: "1 already seen", kind: "command_error" }, ["1", "2"]), null);
  assert.equal(noopFor("seen", { error: "Threads are already seen", kind: "command_error" }, ["1", "2"]).noop, true);

  const paged = shapeEnvelope({ ok: true, data: [{ id: 1 }], meta: { next_page: "2" } }, { path: "x", commandLine: "hey-axi search foo --page 1", pageFlags: ["page"] });
  assert.ok(paged.help.includes("Run `hey-axi search foo --page 2` for the next page"), JSON.stringify(paged.help));

  const { scopeQuery } = await import("../src/scope.js");
  const query = scopeQuery({ config: { search: "$(date)", account: "a b" }, path: "/x/.hey-axi.json" });
  assert.equal(query.base, "hey-axi search '$(date)' --account 'a b'");

  const nested = shapeEnvelope({ ok: true, data: { items: ["a", "b"], has_more: true, total_count: 40 } }, { path: "x", commandLine: "hey-axi x", pageFlags: ["all"] });
  assert.equal(nested.count, "2 of 40 total");
  assert.ok(nested.help.some((line) => /--all` for all 40/.test(line)));

  for (const args of [["setup", "hooks", "--help"], ["setup", "scope", "--help"]]) {
    const help = await runAxi(args);
    for (const line of help.stdout.split("\n").filter((text) => /^\s+--/.test(text))) assert.match(line, /default/, line);
  }

  const { cleanLine } = await import("../src/errors.js");
  assert.equal(cleanLine("TypeError: Cannot read properties of undefined"), "");
  assert.equal(cleanLine("Error: axios ECONNRESET at https://internal.example"), "the connection was reset");
  assert.equal(cleanLine('Get "https://app.hey.com/x": label not found'), "label not found");
});

test("0.3.1: empty counts need proof, empty-list help keeps --account, dependency errors are scrubbed, content lists show ids only", async () => {
  // "0 total" only when HEY says nothing is left, or --all fetched everything.
  assert.equal(shapeEnvelope({ ok: true, data: [] }, { path: "x", commandLine: "hey-axi x" }).count, "0 shown; no more pages reported");
  assert.equal(shapeEnvelope({ ok: true, data: [], meta: { has_more: false } }, { path: "x", commandLine: "hey-axi x" }).count, "0 total");
  assert.equal(shapeEnvelope({ ok: true, data: [], meta: { total_count: 0 } }, { path: "x", commandLine: "hey-axi x" }).count, "0 of 0 total");
  assert.equal(shapeEnvelope([], { path: "x", commandLine: "hey-axi x --all", all: true }).count, "0 total");

  // The empty-list fallback suggestion carries --account.
  const empty = await makeFakeHey({ stdout: '{"ok":true,"data":[]}' });
  const none = await runAxi(["journal", "list", "--account", "7", "--json"], { fake: empty });
  assert.equal(none.code, 0);
  const out = JSON.parse(none.stdout);
  assert.ok(out.help.every((line) => !/`hey-axi /.test(line) || /--account 7/.test(line)), JSON.stringify(out.help));
  await empty.cleanup();

  // Dependency errors and names never reach the agent.
  const { cleanLine, cleanMeta, translateFailure } = await import("../src/errors.js");
  for (const line of ["SqliteError: something broke", "PG::ConnectionBad: could not connect", "sqlalchemy.exc.OperationalError: x", "Error: TypeError: broken", "undici"]) assert.equal(cleanLine(line), "", line);
  assert.equal(cleanLine("SqliteError: database is locked"), "the local database is busy; retry in a moment");
  assert.equal(cleanLine("Error: open /home/u/.cache/hey/db.sqlite: permission denied"), "open a local file: permission denied");
  assert.equal(cleanLine("label not found"), "label not found");
  assert.deepEqual(cleanMeta({ a: "TypeError: broken", b: "undici", c: "SqliteError: x", box: "imbox", id: 5 }), { box: "imbox", id: 5 });
  const failure = translateFailure({ status: 7, stdout: "", stderr: '{"ok":false,"error":"SqliteError: disk I/O error","meta":{"client":"undici"}}' }).failure;
  assert.deepEqual(failure, { ok: false, error: "HEY's API returned an error", kind: "api_error", help: "Retry later, or run `hey-axi doctor`" });

  // Journal, clip and snippet lists show ids and dates; content is one hint away.
  const journal = shapeEnvelope([{ id: 1, starts_at: "2026-10-01", content: "long text" }], { path: "journal list", commandLine: "hey-axi journal list", carry: ["--account", "7"] });
  assert.deepEqual(Object.keys(journal.data[0]), ["id", "date"]);
  assert.ok(journal.help.some((line) => line.includes("`hey-axi journal read <date> --account 7`") && line.includes("--fields id,starts_at,content")));
  const snippets = shapeEnvelope([{ id: 1, name: "sig", content: "x" }], { path: "snippet list", commandLine: "hey-axi snippet list" });
  assert.deepEqual(Object.keys(snippets.data[0]), ["id", "name"]);
  const chosen = shapeEnvelope([{ id: 1, name: "sig", content: "x" }], { path: "snippet list", fields: ["id", "content"], commandLine: "hey-axi snippet list --fields id,content" });
  assert.deepEqual(chosen.data[0], { id: 1, content: "x" });
  assert.equal(chosen.help, undefined);
});
