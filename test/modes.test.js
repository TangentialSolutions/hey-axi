import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { interactivePaths } from "../src/policy.js";
import { heyFailure, translateFailure } from "../src/errors.js";
import { makeFakeHey, makeFakeHeyScript, runAxi } from "./helpers.js";

function startAxi(args, fake) {
  const child = spawn(process.execPath, ["src/hey-axi.js", ...args], { env: { ...process.env, HEY_BIN: fake.bin } });
  const chunks = [];
  child.stdout.on("data", (chunk) => chunks.push({ at: Date.now(), text: chunk.toString() }));
  const done = new Promise((resolve) => child.on("close", (code, signal) => resolve({ code, signal, at: Date.now() })));
  return { child, chunks, done };
}

const waitFor = async (predicate, ms = 5000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

test("commands that need a person are refused without a terminal, before HEY runs", async () => {
  const fake = await makeFakeHey({ stdout: "interactive output\n", exitCode: 3 });
  for (const path of interactivePaths()) {
    const result = await runAxi(path.split(" "), { fake });
    assert.equal(result.code, 2, path);
    assert.match(result.stdout, /error: needs the user/, path);
    assert.match(result.stdout, /hint: .*hey-axi/, path);
  }
  assert.equal((await runAxi(["auth", "login", "--no-browser"], { fake })).code, 2);
  assert.deepEqual(await fake.calls(), []);
  await fake.cleanup();
});

test("auth login --token and HEY's prompt-free setup commands run captured", async () => {
  const fake = await makeFakeHey({ stdout: '{"ok":true,"data":{"authenticated":true}}' });
  const login = await runAxi(["auth", "login", "--token", "t0k"], { fake });
  assert.equal(login.code, 0, login.stdout);
  assert.match(login.stdout, /authenticated: true/);
  const agents = await runAxi(["setup", "agents"], { fake });
  assert.equal(agents.code, 0, agents.stdout);
  assert.deepEqual(await fake.calls(), ["auth login --token t0k --json", "setup agents --json"]);
  await fake.cleanup();
});

test("HEY runs with stdin closed and prompts/editors disabled", async () => {
  const fake = await makeFakeHeyScript(`
if [ -t 0 ]; then tty=yes; else tty=no; fi
input=$(cat)
printf '{"ok":true,"data":{"noninteractive":"%s","editor":"%s","visual":"%s","stdin":"%s"}}' "$HEY_NONINTERACTIVE" "$EDITOR" "$VISUAL" "$input"`);
  const result = await runAxi(["doctor"], { fake });
  assert.equal(result.code, 0, result.stdout);
  assert.match(result.stdout, /noninteractive: "?1"?/);
  assert.match(result.stdout, /editor: "?false"?/);
  assert.match(result.stdout, /visual: "?false"?/);
  assert.match(result.stdout, /stdin: ""/);
  await fake.cleanup();
});

test("watch --json streams each NDJSON line as it arrives, never a partial line", async () => {
  const fake = await makeFakeHeyScript(`
printf '%s\\n' '{"event":"ready"}'
printf '%s' '{"event":"added",'
sleep 1
printf '%s\\n' '"id":1}'
exit 0`);
  const { chunks, done } = startAxi(["watch", "--box", "imbox", "--events", "new", "--json"], fake);
  await waitFor(() => chunks.length > 0);
  const firstAt = chunks[0].at;
  assert.equal(chunks[0].text, '{"event":"ready"}\n');
  const exit = await done;
  assert.equal(exit.code, 0);
  assert.ok(exit.at - firstAt >= 700, "first line should arrive well before HEY exits");
  const text = chunks.map((chunk) => chunk.text).join("");
  assert.equal(text, '{"event":"ready"}\n{"event":"added","id":1}\n');
  for (const chunk of chunks) assert.ok(chunk.text.endsWith("\n"), "chunks end on line boundaries");
  assert.deepEqual(await fake.calls(), ["watch --box imbox --events new --json"]);
  await fake.cleanup();
});

test("watch renders each event as a TOON block by default", async () => {
  const fake = await makeFakeHeyScript(`
printf '%s\\n' '{"event":"ready"}'
printf '%s\\n' '{"event":"added","id":1}'
exit 0`);
  const { chunks, done } = startAxi(["watch"], fake);
  const exit = await done;
  assert.equal(exit.code, 0);
  assert.equal(chunks.map((chunk) => chunk.text).join(""), "event: ready\n\nevent: added\nid: 1\n\n");
  await fake.cleanup();
});

test("watch relays SIGTERM to HEY and exits with HEY's status", async () => {
  const fake = await makeFakeHeyScript(`
trap 'printf "%s\\n" "{\\"event\\":\\"stopped\\"}"; exit 0' TERM
printf '%s\\n' '{"event":"ready"}'
sleep 30 >/dev/null 2>&1 &
wait $!`);
  const { child, chunks, done } = startAxi(["watch"], fake);
  await waitFor(() => chunks.length > 0);
  child.kill("SIGTERM");
  const exit = await done;
  assert.equal(exit.code, 0);
  assert.match(chunks.map((chunk) => chunk.text).join(""), /event: stopped/);
  await fake.cleanup();
});

test("raw-output commands print HEY's output as-is", async () => {
  const fake = await makeFakeHey({ stdout: "# bash completion\ncomplete -F _hey hey\n" });
  const script = await runAxi(["shell-completion", "generate", "bash"], { fake });
  assert.equal(script.code, 0);
  assert.equal(script.stdout, "# bash completion\ncomplete -F _hey hey\n");
  const csv = await runAxi(["timetrack", "export"], { fake });
  assert.equal(csv.code, 0);
  assert.match(csv.stdout, /complete -F/);
  assert.deepEqual(await fake.calls(), ["shell-completion generate bash", "timetrack export"]);
  await fake.cleanup();
});

test("timetrack export --output answers with JSON like other commands", async () => {
  const fake = await makeFakeHey({ stdout: '{"ok":true,"data":{"path":"t.csv"},"summary":"Time tracks exported to t.csv"}' });
  const result = await runAxi(["timetrack", "export", "--output", "t.csv"], { fake });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /summary: Time tracks exported/);
  assert.deepEqual(await fake.calls(), ["timetrack export --output t.csv --json"]);
  await fake.cleanup();
});

test("HEY's JSON error envelope becomes a structured error with an AXI exit code", async () => {
  const fake = await makeFakeHey({
    stdout: "",
    stderr: JSON.stringify({ ok: false, error: "Not logged in", code: "auth", hint: "Run hey auth login" }, null, 2),
    exitCode: 3,
  });
  const result = await runAxi(["box", "list"], { fake });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /error: Not logged in/);
  assert.match(result.stdout, /kind: auth/);
  assert.match(result.stdout, /code: auth/);
  assert.match(result.stdout, /hint: Run hey-axi auth login/);
  assert.match(result.stdout, /help: .*hey-axi auth status/);
  assert.doesNotMatch(result.stdout, /\{/);
  await fake.cleanup();
});

test("non-JSON HEY failures still produce a structured error", async () => {
  const fake = await makeFakeHey({ stdout: "", stderr: "Error: something broke\n", exitCode: 7 });
  const result = await runAxi(["thread", "read", "1"], { fake });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /error: "HEY's API returned an error: something broke"/);
  assert.match(result.stdout, /kind: api_error/);
  await fake.cleanup();
});

test("translateFailure keeps HEY's envelope, maps exit codes to AXI's, and translates the rest", () => {
  assert.deepEqual(
    translateFailure({ status: 2, stderr: '{"ok":false,"error":"Thread not found","code":"not_found","hint":""}', stdout: "" }),
    { failure: { ok: false, error: "Thread not found", kind: "not_found", code: "not_found", help: "Check the id; list commands such as `hey-axi box view imbox` show valid ids (threads use topic_id)" }, exitCode: 1, warnings: [] },
  );
  // Real HEY 1.7.0 output: a keyring warning line, then the indented envelope. The warning goes to stderr.
  assert.deepEqual(
    translateFailure({ status: 3, stdout: "", stderr: 'warning: system keyring unavailable\n{\n  "ok": false,\n  "error": "Not logged in",\n  "code": "auth",\n  "hint": "Run: hey auth login"\n}\n' }),
    { failure: { ok: false, error: "Not logged in", kind: "auth", code: "auth", hint: "Run: hey-axi auth login", help: "Run `hey-axi auth login --token <token>` if you have a token; otherwise ask the user to run `hey-axi auth login --interactive` in their terminal. Check with `hey-axi auth status`" }, exitCode: 1, warnings: ["warning: system keyring unavailable"] },
  );
  // Real HEY 1.7.0 usage error: exit 2, HEY's generic hint dropped, help shows the usage inline.
  assert.deepEqual(
    translateFailure({ status: 1, stderr: '{"ok":false,"error":"accepts at most 1 arg(s), received 2","code":"usage","hint":"Run \'hey --help\' for usage information"}' }, { path: "search", usage: ["usage: hey-axi search [query] [flags]"], example: "hey-axi search \"invoice\"" }),
    { failure: { ok: false, error: "accepts at most 1 arg(s), received 2", kind: "usage", code: "usage", help: ["usage: hey-axi search [query] [flags]", "example: hey-axi search \"invoice\""] }, exitCode: 2, warnings: [] },
  );
  // A failure of no known kind: a specific next step, never "see --help".
  assert.deepEqual(heyFailure({ status: 1, stderr: "", stdout: "" }), { ok: false, error: "the command failed", kind: "command_error", help: ["Run `hey-axi doctor` to check HEY's sign-in, configuration and connection"] });
  assert.deepEqual(heyFailure({ status: 7, stderr: "\u001b[31mError: upstream 502\u001b[0m\ngoroutine 1 [running]:\n  main.go:3\n" }), { ok: false, error: "HEY's API returned an error: upstream 502", kind: "api_error", help: "Retry later, or run `hey-axi doctor`" });
  assert.deepEqual(heyFailure({ status: 127, error: "HEY CLI not found on PATH" }), { ok: false, error: "HEY CLI not found on PATH", kind: "hey_missing", help: "Install the HEY CLI (curl -fsSL https://hey.com/install-cli | bash) or set HEY_BIN" });
});

test("non-JSON output from HEY on success is shown (cut to size), exit 0", async () => {
  const fake = await makeFakeHey({ stdout: "not json" });
  const result = await runAxi(["box", "list"], { fake });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /output: not json/);
  await fake.cleanup();
});

test("account list, box view, label list and commands render TOON", async () => {
  const cases = [
    [["account", "list"], '{"ok":true,"data":[{"id":1,"email":"me@hey.com"}]}', /data\[1\]\{id,email\}:\n\s+1,me@hey.com/],
    [["box", "view", "imbox"], '{"ok":true,"data":[{"id":5,"subject":"Hello"}],"notice":"Showing 1 of 2 results."}', /5,Hello/],
    [["label", "list"], '{"ok":true,"data":[{"id":9,"name":"Receipts"}]}', /9,Receipts/],
    [["commands"], '{"ok":true,"data":[{"name":"box","path":"box","short":"Boxes"}]}', /box,box,Boxes/],
  ];
  for (const [args, stdout, pattern] of cases) {
    const fake = await makeFakeHey({ stdout });
    const result = await runAxi(args, { fake });
    assert.equal(result.code, 0, args.join(" "));
    assert.match(result.stdout, pattern, args.join(" "));
    assert.deepEqual(await fake.calls(), [`${args.join(" ")} --json`]);
    await fake.cleanup();
  }
});
