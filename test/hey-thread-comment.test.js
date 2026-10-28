// HEY main #383 (bcf2799, in the manifest at 7a30c73): `thread comment <thread-id> -m "..."`
// adds a note to a thread. HEY never emails it (internal/cmd/thread_comment.go posts to
// /topics/{id}/comments.json), so hey-axi treats it as an ordinary write. Fake HEY only.
import test from "node:test";
import assert from "node:assert/strict";
import { makeFakeHey, runAxi } from "./helpers.js";
import { loadBundledManifest, resolveCommand } from "../src/router.js";
import { checkPolicy, sendCommands, destructiveCommands, noopFor } from "../src/policy.js";

const manifest = loadBundledManifest();

// HEY's writeMutationLine envelope for a note (shape from internal/cmd/thread_comment.go).
const NOTE_OK = JSON.stringify({ ok: true, data: { id: 987, thread_id: 12345, visible_to: [], collection_only: false }, summary: "Note 987 added to thread 12345", breadcrumbs: [{ action: "read", command: "hey thread read 12345", description: "Read this thread" }] });
const DRY_OK = JSON.stringify({ ok: true, data: { thread_id: 12345, visible_to: [{ name: "Sam", email_address: "sam@example.com" }], collection_only: false, dry_run: true }, summary: "Dry run: a note on thread 12345 would reach you and 1 other person" });

test("the manifest has thread comment with HEY's flags and synopsis", () => {
  const node = resolveCommand(manifest.commands, ["thread", "comment"]);
  assert.equal(node.path, "thread comment");
  assert.deepEqual(node.node.synopsis, ["hey thread comment <thread-id> [flags]"]);
  assert.deepEqual(node.node.flags.map((flag) => flag.name).sort(), ["dry-run", "message", "message-html"]);
});

test("thread comment is an ordinary write: not a send, destructive or a no-op candidate", () => {
  assert.ok(!sendCommands().includes("thread comment"));
  assert.ok(!destructiveCommands().includes("thread comment"));
  assert.equal(checkPolicy("thread comment", new Set(["--message"]), {}), null);
  assert.equal(noopFor("thread comment", { ok: false, error: "already added", kind: "conflict" }, ["12345"], {}), null);
});

test("thread comment forwards argv intact, needs no opt-in, and keeps HEY's summary and next-command hint", async () => {
  const fake = await makeFakeHey({ stdout: NOTE_OK });
  const ok = await runAxi(["thread", "comment", "12345", "-m", "Following up with accounting."], { fake, env: { HEY_AXI_ALLOW_SEND: "" } });
  assert.equal(ok.code, 0, ok.stdout);
  assert.match(ok.stdout, /summary: Note 987 added to thread 12345/);
  assert.match(ok.stdout, /hey-axi thread read 12345/);
  assert.doesNotMatch(ok.stdout, /\bhey thread read/);
  assert.doesNotMatch(ok.stdout, /DRAFT|allow-send/);
  assert.deepEqual(await fake.calls(), ["thread comment 12345 -m Following up with accounting. --json"]);
  await fake.cleanup();
});

test("thread comment --dry-run runs without a message", async () => {
  const fake = await makeFakeHey({ stdout: DRY_OK });
  const dry = await runAxi(["thread", "comment", "12345", "--dry-run"], { fake });
  assert.equal(dry.code, 0, dry.stdout);
  assert.match(dry.stdout, /would reach you and 1 other person/);
  assert.deepEqual(await fake.calls(), ["thread comment 12345 --dry-run --json"]);
  await fake.cleanup();
});

test("thread comment argument checks: thread id required, one only, unknown flags refused before HEY runs", async () => {
  const fake = await makeFakeHey({ stdout: NOTE_OK });
  const noId = await runAxi(["thread", "comment", "-m", "x"], { fake });
  assert.equal(noId.code, 2);
  assert.match(noId.stdout, /missing argument <thread-id> for `thread comment`/);
  const two = await runAxi(["thread", "comment", "1", "2", "-m", "x"], { fake });
  assert.equal(two.code, 2);
  const bogus = await runAxi(["thread", "comment", "12345", "-m", "x", "--to", "a@b.c"], { fake });
  assert.equal(bogus.code, 2);
  assert.deepEqual(await fake.calls(), []);
  await fake.cleanup();
});

test("HEY's refusal of a blank note is a usage error (exit 2)", async () => {
  const fake = await makeFakeHey({ exitCode: 2, stdout: "", stderr: '{"ok":false,"error":"a note is required (use -m <text> or --message-html <html>)","code":"usage"}\n' });
  const result = await runAxi(["thread", "comment", "12345"], { fake });
  assert.equal(result.code, 2, result.stdout);
  assert.match(result.stdout, /a note is required/);
  await fake.cleanup();
});

test("thread comment on a HEY without it (v1.10.1 and older) is named as outdated", async () => {
  const fake = await makeFakeHey({ exitCode: 1, stdout: "", stderr: '{"ok":false,"error":"unknown command \\"comment\\" for \\"hey thread\\"","code":"usage"}\n' });
  const result = await runAxi(["thread", "comment", "12345", "-m", "x"], { fake });
  assert.equal(result.code, 1, result.stdout);
  assert.match(result.stdout, /kind: hey_outdated/);
  assert.match(result.stdout, /doesn't have the command `thread comment`/);
  assert.match(result.stdout, /v1\.10\.1 plus the commands on HEY main as of 2026-10-27 \(commit 7a30c73, unreleased\)/);
  await fake.cleanup();
});
