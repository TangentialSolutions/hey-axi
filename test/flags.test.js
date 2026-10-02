import test from "node:test";
import assert from "node:assert/strict";
import { scanArgs, valueFlagSet } from "../src/args.js";
import { loadBundledManifest } from "../src/router.js";
import { makeFakeHey, runAxi } from "./helpers.js";

const valueFlags = valueFlagSet(loadBundledManifest().commands);

test("scanArgs skips flag values when finding command words", () => {
  assert.deepEqual(scanArgs(["--account", "5", "box", "list"], valueFlags).words, ["box", "list"]);
  assert.deepEqual(scanArgs(["box", "--account=5", "view", "imbox"], valueFlags).words, ["box", "view", "imbox"]);
  assert.deepEqual(scanArgs(["reply", "12", "-m", "hello there", "--draft"], valueFlags).words, ["reply", "12"]);
  assert.deepEqual(scanArgs(["--jq", ".data[]", "--base-url", "http://x", "search", "--from", "a@b.c", "q"], valueFlags).words, ["search", "q"]);
  assert.deepEqual(scanArgs(["search", "--", "--literal"], valueFlags).words, ["search", "--literal"]);
  assert.ok(scanArgs(["box", "list", "--all"], valueFlags).flags.has("--all"));
});

test("global flags are accepted anywhere on the line and forwarded in place", async () => {
  const fake = await makeFakeHey();
  const lines = [
    ["--account", "5", "box", "list"],
    ["box", "--account", "5", "view", "imbox"],
    ["--base-url", "http://localhost:3000", "label", "list", "--stats"],
    ["-v", "thread", "read", "123"],
  ];
  for (const line of lines) assert.equal((await runAxi(line, { fake })).code, 0, line.join(" "));
  assert.deepEqual(await fake.calls(), [
    "--account 5 box list --json",
    "box --account 5 view imbox --json",
    "--base-url http://localhost:3000 label list --stats --json",
    "-v thread read 123 --json",
  ]);
  await fake.cleanup();
});

test("raw output selectors are passed through untouched and printed as-is", async () => {
  const fake = await makeFakeHey({ stdout: "111\n222\n" });
  for (const flag of ["--ids-only", "--count", "--markdown", "--html", "--styled"]) {
    const result = await runAxi(["box", "view", "imbox", flag], { fake });
    assert.equal(result.code, 0, flag);
    assert.equal(result.stdout, "111\n222\n", flag);
  }
  const jq = await runAxi(["--jq", ".data[].id", "box", "view", "imbox"], { fake });
  assert.equal(jq.stdout, "111\n222\n");
  assert.deepEqual(await fake.calls(), [
    "box view imbox --ids-only", "box view imbox --count", "box view imbox --markdown",
    "box view imbox --html", "box view imbox --styled", "--jq .data[].id box view imbox",
  ]);
  await fake.cleanup();
});

test("raw mode propagates HEY's exit code and stderr", async () => {
  const fake = await makeFakeHey({ stdout: "", stderr: "Error: --ids-only requires list data\n", exitCode: 1 });
  const result = await runAxi(["version", "--ids-only"], { fake });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /requires list data/);
  await fake.cleanup();
});

test("default output keeps the envelope (notices, next_page) and renders TOON", async () => {
  const fake = await makeFakeHey({ stdout: '{"ok":true,"data":[{"id":1}],"notice":"Showing 1 of 9 results. Use --all to see everything."}' });
  const result = await runAxi(["box", "view", "imbox"], { fake });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /notice: Showing 1 of 9/);
  assert.match(result.stdout, /ok: true/);
  assert.deepEqual(await fake.calls(), ["box view imbox --json"]);
  await fake.cleanup();
});

test("--json prints the shaped envelope as compact JSON; --full keeps HEY's untouched", async () => {
  const envelope = { ok: true, data: [{ id: 1 }], summary: "1 thread", breadcrumbs: [{ action: "read", command: "hey thread read 1", description: "Read" }] };
  const fake = await makeFakeHey({ stdout: JSON.stringify(envelope, null, 2) });
  const result = await runAxi(["box", "view", "imbox", "--json"], { fake });
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, summary: "1 thread", data: [{ id: 1 }], help: ["Run `hey-axi thread read 1` to read"] });
  assert.equal(result.stdout.trim().split("\n").length, 1);
  const untouched = await runAxi(["box", "view", "imbox", "--json", "--full"], { fake });
  assert.deepEqual(JSON.parse(untouched.stdout), envelope);
  assert.deepEqual(await fake.calls(), ["box view imbox --json", "box view imbox --json"]);
  await fake.cleanup();
});

test("--quiet is honored when the user asks for data only", async () => {
  const fake = await makeFakeHey({ stdout: '[{"id":1}]' });
  const result = await runAxi(["box", "view", "imbox", "--quiet"], { fake });
  assert.equal(result.code, 0);
  assert.deepEqual(await fake.calls(), ["box view imbox --json --quiet"]);
  await fake.cleanup();
});

test("HEY's stderr notices are surfaced on success", async () => {
  const fake = await makeFakeHey({ stdout: '{"ok":true,"data":[]}', stderr: "next_page: abc\n" });
  const result = await runAxi(["box", "view", "imbox"], { fake });
  assert.equal(result.code, 0);
  assert.match(result.stderr, /next_page: abc/);
  await fake.cleanup();
});

test("help documents the real --json/--quiet behavior", async () => {
  const result = await runAxi(["--help"]);
  assert.doesNotMatch(result.stdout, /Preserve the upstream JSON envelope/);
  assert.match(result.stdout, /--json\s+Print HEY's JSON envelope/);
  assert.match(result.stdout, /--ids-only, --count, --markdown, --html, --styled, --jq/);
});
