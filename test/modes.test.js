import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { interactivePaths } from "../src/policy.js";
import { heyFailure } from "../src/errors.js";
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

test("interactive commands get HEY untouched: no --json, output as-is, exit code passed through", async () => {
  const fake = await makeFakeHey({ stdout: "interactive output\n", exitCode: 3 });
  const paths = interactivePaths().filter((path) => path !== "tui");
  for (const path of paths) {
    const result = await runAxi(path.split(" "), { fake });
    assert.equal(result.code, 3, path);
    assert.equal(result.stdout, "interactive output\n", path);
  }
  assert.equal((await runAxi(["auth", "login", "--no-browser"], { fake })).code, 3);
  assert.deepEqual(await fake.calls(), [...paths, "auth login --no-browser"]);
  await fake.cleanup();
});

test("tui is refused without a terminal and HEY is not started", async () => {
  const fake = await makeFakeHey();
  const result = await runAxi(["tui"], { fake });
  assert.equal(result.code, 2);
  assert.match(result.stdout, /needs a terminal/);
  assert.deepEqual(await fake.calls(), []);
  await fake.cleanup();
});

test("watch streams each NDJSON line as it arrives, never a partial line", async () => {
  const fake = await makeFakeHeyScript(`
printf '%s\\n' '{"event":"ready"}'
printf '%s' '{"event":"added",'
sleep 1
printf '%s\\n' '"id":1}'
exit 0`);
  const { chunks, done } = startAxi(["watch", "--box", "imbox", "--events", "new"], fake);
  await waitFor(() => chunks.length > 0);
  const firstAt = chunks[0].at;
  assert.equal(chunks[0].text, '{"event":"ready"}\n');
  const exit = await done;
  assert.equal(exit.code, 0);
  assert.ok(exit.at - firstAt >= 700, "first line should arrive well before HEY exits");
  const text = chunks.map((chunk) => chunk.text).join("");
  assert.equal(text, '{"event":"ready"}\n{"event":"added","id":1}\n');
  for (const chunk of chunks) assert.ok(chunk.text.endsWith("\n"), "chunks end on line boundaries");
  assert.deepEqual(await fake.calls(), ["watch --box imbox --events new"]);
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
  assert.match(chunks.map((chunk) => chunk.text).join(""), /"stopped"/);
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

test("HEY's JSON error envelope becomes a structured error with HEY's exit code", async () => {
  const fake = await makeFakeHey({
    stdout: "",
    stderr: JSON.stringify({ ok: false, error: "Not logged in", code: "auth", hint: "Run hey auth login" }, null, 2),
    exitCode: 3,
  });
  const result = await runAxi(["box", "list"], { fake });
  assert.equal(result.code, 3);
  assert.match(result.stdout, /error: Not logged in/);
  assert.match(result.stdout, /code: auth/);
  assert.match(result.stdout, /hint: Run hey-axi auth login/);
  assert.match(result.stdout, /exit_code: 3/);
  assert.doesNotMatch(result.stdout, /\{/);
  await fake.cleanup();
});

test("non-JSON HEY failures still produce a structured error", async () => {
  const fake = await makeFakeHey({ stdout: "", stderr: "Error: something broke\n", exitCode: 7 });
  const result = await runAxi(["thread", "read", "1"], { fake });
  assert.equal(result.code, 7);
  assert.match(result.stdout, /error: "Error: something broke"/);
  await fake.cleanup();
});

test("heyFailure prefers HEY's envelope and drops empty fields", () => {
  assert.deepEqual(
    heyFailure({ status: 2, stderr: '{"ok":false,"error":"Thread not found","code":"not_found","hint":""}', stdout: "" }),
    { ok: false, error: "Thread not found", code: "not_found", exit_code: 2, help: "Check the id; list commands such as `hey-axi box view imbox` show valid ids (threads use topic_id)" },
  );
  // Real HEY 1.7.0 output: a keyring warning line, then the indented envelope.
  assert.deepEqual(
    heyFailure({ status: 3, stdout: "", stderr: 'warning: system keyring unavailable\n{\n  "ok": false,\n  "error": "Not logged in",\n  "code": "auth",\n  "hint": "Run: hey auth login"\n}\n' }),
    { ok: false, error: "Not logged in", code: "auth", hint: "Run: hey-axi auth login", warning: "warning: system keyring unavailable", exit_code: 3 },
  );
  assert.deepEqual(heyFailure({ status: 1, stderr: "", stdout: "" }), { ok: false, error: "hey command failed", exit_code: 1, help: "Run `hey-axi <command> --help` to check the arguments" });
  assert.deepEqual(heyFailure({ status: 127, error: "HEY CLI not found on PATH" }), { ok: false, error: "HEY CLI not found on PATH", exit_code: 127, help: "Install the HEY CLI (curl -fsSL https://hey.com/install-cli | bash) or set HEY_BIN" });
});

test("invalid JSON from HEY on success is reported, exit 1", async () => {
  const fake = await makeFakeHey({ stdout: "not json" });
  const result = await runAxi(["box", "list"], { fake });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /HEY returned invalid JSON/);
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
