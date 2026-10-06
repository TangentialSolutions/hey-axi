// The gaps the catalog reviewer listed against 0.3.1 (home "nothing" without completeness
// evidence is covered in axi.test.js).
import test from "node:test";
import assert from "node:assert/strict";
import { makeFakeHey, runAxi } from "./helpers.js";
import { noopFor } from "../src/policy.js";
import { cleanLine, cleanMeta, translateFailure } from "../src/errors.js";

test("a failure of no known kind suggests a specific fix (usage inline, then doctor), never --help", async () => {
  const fake = await makeFakeHey({ exitCode: 1, stdout: "", stderr: "something odd happened\n" });
  const result = await runAxi(["thread", "read", "5", "--account", "8"], { fake });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /kind: command_error/);
  assert.match(result.stdout, /usage: hey-axi thread read <thread-id> \[flags\]/);
  assert.match(result.stdout, /example: hey-axi thread read 12345/);
  assert.match(result.stdout, /Run `hey-axi doctor --account 8` if the arguments are right/);
  assert.doesNotMatch(result.stdout, /--help/);
  await fake.cleanup();

  // HEY's own usage error: the usage line and an example, inline.
  const usage = await makeFakeHey({ exitCode: 1, stdout: "", stderr: '{"ok":false,"error":"accepts at most 1 arg(s), received 2","code":"usage","hint":"Run \'hey --help\' for usage information"}' });
  const bad = await runAxi(["contact", "show", "5"], { fake: usage });
  assert.equal(bad.code, 2);
  assert.match(bad.stdout, /usage: hey-axi contact show <id> \[flags\]/);
  assert.doesNotMatch(bad.stdout, /--help/);
  await usage.cleanup();

  // No command known (the home view): doctor.
  assert.deepEqual(translateFailure({ status: 1, stderr: "x", stdout: "" }).failure.help, ["Run `hey-axi doctor` to check HEY's sign-in, configuration and connection"]);
});

test("a single-id command is only 'already done' when HEY's message is about that id", async () => {
  const failure = (error) => ({ ok: false, error, kind: "command_error" });
  // The reviewer's case: "1 already seen" is about id 1 (or a count), not about `seen 2`.
  assert.equal(noopFor("seen", failure("1 already seen"), ["2"]), null);
  assert.equal(noopFor("seen", failure("Thread 7 is already seen"), ["2"]), null);
  assert.equal(noopFor("unseen", failure("3 already unseen"), ["2"]), null);
  assert.equal(noopFor("trash", failure("Already in trash: 9"), ["4"]), null);
  // About the id asked for, or naming no id at all: a no-op.
  assert.equal(noopFor("seen", failure("2 already seen"), ["2"]).noop, true);
  assert.equal(noopFor("seen", failure("Already seen"), ["2"]).noop, true);
  // Batches: every id named, or "all N" for the whole batch.
  assert.equal(noopFor("seen", failure("5 already seen"), ["5", "6"]), null);
  assert.equal(noopFor("seen", failure("2 already seen"), ["5", "6"]), null);
  assert.equal(noopFor("seen", failure("5, 6 already seen"), ["5", "6"]).noop, true);
  assert.equal(noopFor("seen", failure("all 2 already seen"), ["5", "6"]).noop, true);
  // A container named by number is the one asked for.
  assert.equal(noopFor("label add", failure("Already in label 9"), ["5"], { to: "9" }).noop, true);
  assert.equal(noopFor("label add", failure("Already in label 8"), ["5"], { to: "9" }), null);

  const fake = await makeFakeHey({ exitCode: 1, stdout: "", stderr: '{"ok":false,"error":"1 already seen","code":"conflict"}' });
  const result = await runAxi(["seen", "2"], { fake });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /ok: false/);
  assert.doesNotMatch(result.stdout, /noop/);
  await fake.cleanup();
});

test("library names inside sentences and non-HEY error codes don't leak", () => {
  assert.equal(cleanLine("request via superagent failed with 500"), "");
  assert.equal(cleanLine("Error: the undici pool is closed"), "");
  assert.equal(cleanLine("superagent: bad gateway"), "bad gateway");
  // Ordinary words that happen to be library names stay.
  assert.equal(cleanLine("expected a number, got text"), "expected a number, got text");
  assert.equal(cleanLine("node 5 not found"), "node 5 not found");
  assert.deepEqual(cleanMeta({ client: "request made with undici v6", engine: "Node.js 22", box: "imbox", reason: "label is full" }), { box: "imbox", reason: "label is full" });

  const sqlite = translateFailure({ status: 7, stdout: "", stderr: '{"ok":false,"error":"SqliteError: disk I/O error","code":"SqliteError","meta":{"client":"via undici"}}' }).failure;
  assert.equal(sqlite.code, undefined);
  assert.equal(sqlite.meta, undefined);
  assert.equal(sqlite.error, "HEY's API returned an error");
  for (const code of ["SQLITE_BUSY", "ECONNRESET", "TypeError"]) {
    assert.equal(translateFailure({ status: 7, stderr: JSON.stringify({ ok: false, error: "x", code }) }).failure.code, undefined, code);
  }
  for (const code of ["not_found", "rate_limit", "api", "validation"]) {
    assert.equal(translateFailure({ status: 7, stderr: JSON.stringify({ ok: false, error: "x", code }) }).failure.code, code, code);
  }
});
