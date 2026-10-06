// Commands and send behavior from HEY's main branch after v1.7.0 (unreleased as of
// 2026-10-03), read with the same fake HEY as the rest of the catalog. The send fixtures
// are real HEY output (test/fixtures/hey-main/README.md).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeFakeHey, runAxi } from "./helpers.js";
import { loadBundledManifest, resolveCommand, coverageLabel } from "../src/router.js";
import { runMode, checkPolicy, sendCommands } from "../src/policy.js";
import { noopFor } from "../src/policy.js";
import { markSent, recipientProblem, splitAddresses } from "../src/send.js";
import { translateFailure } from "../src/errors.js";

const fixture = (name) => readFileSync(new URL(`./fixtures/hey-main/${name}`, import.meta.url), "utf8");
const manifest = loadBundledManifest();
const allowSend = { HEY_AXI_ALLOW_SEND: "1" };
const noOptIn = { HEY_AXI_ALLOW_SEND: "", HEY_AXI_ALLOW_SECRETS: "" };

test("the manifest has the commands and flags HEY main added after v1.7.0", () => {
  const deliver = resolveCommand(manifest.commands, ["contact", "deliver"]);
  assert.equal(deliver.path, "contact deliver");
  assert.deepEqual(deliver.node.flags.map((flag) => [flag.name, flag.value, flag.type]), [["to", true, "string"]]);
  assert.deepEqual(deliver.node.synopsis, ["hey contact deliver <contact-id> [flags]"]);
  const del = resolveCommand(manifest.commands, ["event", "delete"]).node;
  assert.deepEqual(del.flags.map((flag) => flag.name).sort(), ["apply-to", "occurrence"]);
  assert.equal(coverageLabel(manifest), "v1.7.0 plus the commands on HEY main as of 2026-10-03 (commit 8bf9310, unreleased)");
  assert.equal(coverageLabel({ hey_version: "1.8.0" }), "v1.8.0");
});

test("contact deliver and event delete get the same safety classification as their neighbours", () => {
  for (const path of ["contact deliver", "event delete"]) {
    assert.equal(runMode(path, new Set()), "json", path);
    assert.equal(checkPolicy(path, new Set(), {}, { stdin: true, stdout: true }), null, path);
    assert.ok(!sendCommands().includes(path), path);
  }
});

test("contact deliver: --to is required and takes only HEY's four destinations; the rest is forwarded intact", async () => {
  const fake = await makeFakeHey({ stdout: fixture("contact-deliver.json") });
  const ok = await runAxi(["contact", "deliver", "12345", "--to", "feed"], { fake });
  assert.equal(ok.code, 0, ok.stdout);
  assert.match(ok.stdout, /summary: Contact delivery changed/);
  assert.match(ok.stdout, /destination: feed/);

  const missing = await runAxi(["contact", "deliver", "12345"], { fake });
  assert.equal(missing.code, 2);
  assert.match(missing.stdout, /missing required flag --to for `contact deliver`/);
  const wrong = await runAxi(["contact", "deliver", "12345", "--to", "spam"], { fake });
  assert.equal(wrong.code, 2);
  assert.match(wrong.stdout, /--to takes one of imbox, feed, papertrail, screened-out, got \\"spam\\"/);
  const noId = await runAxi(["contact", "deliver", "--to", "feed"], { fake });
  assert.equal(noId.code, 2);
  assert.match(noId.stdout, /missing argument <contact-id> for `contact deliver`/);
  assert.deepEqual(await fake.calls(), ["contact deliver 12345 --to feed --json"]);
  await fake.cleanup();
});

test("event delete --occurrence/--apply-to: forwarded together, refused alone or with another scope", async () => {
  const fake = await makeFakeHey({ stdout: '{"ok":true,"data":{"occurrence_id":"4821_2026-09-15","apply_to":"current"},"summary":"Occurrence deleted"}' });
  const ok = await runAxi(["event", "delete", "4821", "--occurrence", "4821_2026-09-15", "--apply-to", "current"], { fake });
  assert.equal(ok.code, 0, ok.stdout);
  assert.match(ok.stdout, /occurrence_id: 4821_2026-09-15/);
  const whole = await runAxi(["event", "delete", "4821"], { fake });
  assert.equal(whole.code, 0);
  for (const [line, pattern] of [
    [["event", "delete", "4821", "--occurrence", "4821_2026-09-15"], /--occurrence needs --apply-to for `event delete`/],
    [["event", "delete", "4821", "--apply-to", "future"], /--apply-to needs --occurrence for `event delete`/],
    [["event", "delete", "4821", "--occurrence", "4821_2026-09-15", "--apply-to", "all"], /--apply-to takes one of current, future/],
    [["event", "edit", "4821", "--apply-to", "current", "--title", "x"], /--apply-to needs --occurrence for `event edit`/],
  ]) {
    const result = await runAxi(line, { fake });
    assert.equal(result.code, 2, line.join(" "));
    assert.match(result.stdout, pattern, line.join(" "));
  }
  assert.deepEqual(await fake.calls(), ["event delete 4821 --occurrence 4821_2026-09-15 --apply-to current --json", "event delete 4821 --json"]);
  await fake.cleanup();
});

test("--help for the new commands states the required flag, the allowed values and the pairing, offline", async () => {
  const deliver = await runAxi(["contact", "deliver", "--help"]);
  assert.equal(deliver.code, 0);
  assert.match(deliver.stdout, /usage: hey-axi contact deliver <contact-id> \[flags\]/);
  assert.match(deliver.stdout, /--to <string>  Delivery destination: .* \(required\) one of: imbox, feed, papertrail, screened-out \(default: none\)/);
  assert.match(deliver.stdout, /examples:\n  hey-axi contact deliver 12345 --to feed\n  hey-axi contact deliver 12345 --to screened-out/);
  assert.match(deliver.stdout, /notes: Use a contact ID from `hey-axi contact list`/);
  const del = await runAxi(["event", "delete", "--help"]);
  assert.match(del.stdout, /--occurrence <string>/);
  assert.match(del.stdout, /--apply-to <string> .*one of: current, future/);
  assert.match(del.stdout, /--occurrence and --apply-to go together: pass both or neither/);
  assert.match(del.stdout, /hey-axi event delete 4821 --occurrence 4821_2026-09-15 --apply-to current/);
});

test("deleting one day of a series is never an 'already gone' no-op; deleting the series still is", () => {
  const failure = { ok: false, error: "event not found", kind: "not_found" };
  assert.equal(noopFor("event delete", failure, ["4821"], { occurrence: "4821_2026-09-15" }), null);
  assert.equal(noopFor("event delete", failure, ["4821"], {}).noop, true);
});

test("a HEY older than the catalog (v1.7.0 has no contact deliver) is named as such, not as a usage error", async () => {
  // Real v1.7.0 output for `hey contact deliver 5 --to feed --json`.
  const fake = await makeFakeHey({ exitCode: 1, stdout: "", stderr: '{\n  "ok": false,\n  "error": "unknown flag: --to",\n  "code": "usage",\n  "hint": "Run \'hey --help\' for usage information"\n}\n' });
  const result = await runAxi(["contact", "deliver", "5", "--to", "feed", "--account", "8"], { fake });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /kind: hey_outdated/);
  assert.match(result.stdout, /the installed HEY CLI doesn't have --to for `contact deliver`; hey-axi's catalog is HEY CLI v1\.7\.0 plus the commands on HEY main/);
  assert.match(result.stdout, /Run `hey-axi version --account 8` to see which HEY is installed/);
  await fake.cleanup();
});

test("a delivered message says sent: true and keeps the message and thread HEY names (HEY main)", async () => {
  const fake = await makeFakeHey({ stdout: fixture("compose-sent.json") });
  const result = await runAxi(["compose", "--to", "maria@example.com", "--subject", "Board update", "-m", "Numbers", "--allow-send"], { fake });
  assert.equal(result.code, 0, result.stdout);
  assert.match(result.stdout, /^ok: true\nsent: true\nsummary: Message sent\n/);
  assert.match(result.stdout, /id: 3301/);
  assert.match(result.stdout, /topic_id: 4401/);
  assert.match(result.stdout, /delayed: false/);
  assert.doesNotMatch(result.stdout, /held:/);
  assert.match(result.stdout, /Run `hey-axi thread read 4401` to read the thread/);
  assert.deepEqual(await fake.calls(), ["compose --to maria@example.com --subject Board update -m Numbers --json"]);
  await fake.cleanup();
});

test("a message Undo Send is holding back is sent, but the thread won't show it yet", async () => {
  const fake = await makeFakeHey({ stdout: fixture("compose-delayed.json") });
  const result = await runAxi(["compose", "--to", "maria@example.com", "--subject", "Board update", "-m", "Numbers", "--json"], { fake, env: allowSend });
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.sent, true);
  assert.equal(parsed.data.delayed, true);
  assert.match(parsed.held, /^Undo Send is holding it back: it goes out when HEY releases it, and until then `hey-axi thread read 4401` won't show it/);
  assert.ok(parsed.help.includes("Run `hey-axi thread read 4401` to read the thread once Undo Send releases the message"));
  await fake.cleanup();
});

test("v1.7.0's answer (no ids) is still read as a send, with nothing guessed", async () => {
  const fake = await makeFakeHey({ stdout: fixture("compose-sent-v1.7.0.json") });
  const result = await runAxi(["reply", "4401", "-m", "Thanks", "--allow-send", "--json"], { fake });
  assert.equal(result.code, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.sent, true);
  assert.equal(parsed.summary, "Message sent");
  assert.equal(parsed.held, undefined);
  assert.equal(parsed.data, undefined);
  await fake.cleanup();
});

test("a staged draft is still sent: false with HEY main's draft answer", async () => {
  const fake = await makeFakeHey({ stdout: '{"ok":true,"data":{"id":2201},"summary":"Draft saved","breadcrumbs":[{"action":"show","command":"hey draft show 2201","description":"Read the draft back"}]}' });
  const result = await runAxi(["compose", "--to", "maria@example.com", "--subject", "Hi", "-m", "x"], { fake, env: noOptIn });
  assert.match(result.stdout, /^ok: true\nsent: false\nsaved_as: draft/);
  assert.doesNotMatch(result.stdout, /sent: true/);
  await fake.cleanup();
});

test("a send HEY refused is reported as not sent, names the draft, and never says retry", async () => {
  const state = mkdtempSync(join(tmpdir(), "hey-axi-nd-"));
  writeFileSync(join(state, "capture-enabled"), "on\n");
  for (const line of [
    ["compose", "--to", "maria@example.com", "--subject", "Board update", "-m", "Numbers", "--allow-send"],
    ["draft", "send", "2201", "--allow-send"],
    ["forward", "7", "--to", "alice@example.com", "--allow-send"],
  ]) {
    const fake = await makeFakeHey({ exitCode: 7, stdout: "", stderr: fixture("compose-refused.stderr.json") });
    const result = await runAxi([...line, "--account", "8"], { fake, env: { HEY_AXI_STATE_DIR: state } });
    assert.equal(result.code, 1, line.join(" "));
    assert.match(result.stdout, /^ok: false\nkind: not_delivered\nsent: false\nerror: "not sent: HEY kept the message as draft 2201 instead of sending it \(usually the account's sending limit\)"\ndraft_id: "2201"/, line.join(" "));
    assert.match(result.stdout, /Run `hey-axi draft show 2201 --account 8` to review it/);
    assert.match(result.stdout, /Run `hey-axi draft send 2201 --allow-send --account 8` later, once the account can send again; don't repeat the send, which only makes another draft/);
    assert.doesNotMatch(result.stdout, /Retry|api_error|code: not_delivered/);
    await fake.cleanup();
  }
  // The kept draft is remembered as a draft (for the next home view), not as a send.
  const journal = readFileSync(join(state, "activity.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(journal.map((entry) => [entry.path, entry.kind, entry.ids]), [["compose", "draft", ["2201"]], ["draft send", "draft", ["2201"]], ["forward", "draft", ["2201"]]]);
  rmSync(state, { recursive: true, force: true });
});

test("a recipient HEY would drop is refused before HEY runs; HEY main's own refusal reads the same", async () => {
  const fake = await makeFakeHey();
  for (const line of [
    ["compose", "--to", "maria", "--subject", "Hi", "-m", "x"],
    ["reply", "5", "--to", "ok@example.com", "--cc", "Bob <bob@localhost>", "-m", "x"],
    ["forward", "5", "--to", "a@example.com, b@", "--allow-send"],
    ["draft", "edit", "5", "--bcc=nobody"],
  ]) {
    const result = await runAxi(line, { fake, env: noOptIn });
    assert.equal(result.code, 2, line.join(" "));
    assert.match(result.stdout, /error: "?not a valid email address: /, line.join(" "));
    assert.match(result.stdout, /sent: false/);
    assert.match(result.stdout, /every recipient needs a full address such as name@example\.com/);
  }
  assert.deepEqual(await fake.calls(), []);
  await fake.cleanup();

  // HEY main refuses an unknown top-level domain hey-axi lets through (real output).
  const hey = await makeFakeHey({ exitCode: 1, stdout: "", stderr: '{\n  "ok": false,\n  "error": "not a valid email address: bob@example.invalidtld",\n  "code": "usage"\n}\n' });
  const refused = await runAxi(["reply", "5", "--to", "bob@example.invalidtld", "-m", "hi", "--allow-send"], { fake: hey });
  assert.equal(refused.code, 2);
  assert.match(refused.stdout, /kind: usage/);
  assert.match(refused.stdout, /sent: false/);
  assert.match(refused.stdout, /fix or remove \\"bob@example\.invalidtld\\"/);
  assert.doesNotMatch(refused.stdout, /--help/);
  await hey.cleanup();
});

test("well-formed recipients pass the check, including quoted names with commas and an emptied list", async () => {
  assert.deepEqual(splitAddresses('"Bryan, Annie" <annie@example.com>, bob@example.co.uk'), ['"Bryan, Annie" <annie@example.com>', "bob@example.co.uk"]);
  assert.equal(recipientProblem("compose", [["--to", '"Bryan, Annie" <annie@example.com>, bob@example.co.uk'], ["--cc", "zoë@exämple.de"]]), null);
  assert.equal(recipientProblem("draft edit", [["--to", ""]]), null);
  assert.equal(recipientProblem("move", [["--to", "feed"]]), null);
  assert.equal(recipientProblem("label add", [["--to", "Receipts"]]), null);
  const fake = await makeFakeHey({ stdout: '{"ok":true,"data":{"id":9},"summary":"Draft saved"}' });
  const result = await runAxi(["compose", "--to", "Annie <annie@example.com>", "--subject", "Hi", "-m", "x"], { fake, env: noOptIn });
  assert.equal(result.code, 0, result.stdout);
  await fake.cleanup();
});

test("markSent leaves non-objects alone and only claims what HEY said", () => {
  assert.equal(markSent(null), null);
  assert.deepEqual(markSent({ ok: true, summary: "Message forwarded", data: { thread_id: 7, entry_id: 8, id: 9, topic_id: 10, delayed: true } }).held.includes("thread read 10"), true);
  assert.deepEqual(markSent({ summary: "x" }), { sent: true, summary: "x" });
});

test("not_delivered without meta still finds the draft in HEY's hint", () => {
  const { failure, exitCode } = translateFailure({ status: 7, stderr: '{"ok":false,"error":"HEY kept this message as draft 77 instead of sending it","code":"not_delivered","hint":"hey draft send 77"}' }, { path: "reply" });
  assert.equal(exitCode, 1);
  assert.equal(failure.draft_id, "77");
  assert.equal(failure.kind, "not_delivered");
});
