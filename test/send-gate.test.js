import test from "node:test";
import assert from "node:assert/strict";
import { makeFakeHey, runAxi } from "./helpers.js";

const noOptIn = { HEY_AXI_ALLOW_SEND: "", HEY_AXI_ALLOW_SECRETS: "" };
const sendLines = [
  ["compose", "--to", "a@example.com", "--subject", "Hi", "-m", "hello"],
  ["reply", "123", "-m", "thanks"],
  ["forward", "123", "--to", "b@example.com"],
  ["draft", "send", "77"],
  ["bulk-reply", "send", "1", "2", "-m", "hi all"],
];

const NOT_SENT = /saved_as: draft/;

test("compose and reply without opt-in are saved as drafts, never sent", async () => {
  const fake = await makeFakeHey({ stdout: '{"ok":true,"data":{"draft_id":9},"summary":"Draft saved"}' });
  for (const line of [sendLines[0], sendLines[1]]) {
    const result = await runAxi(line, { fake, env: noOptIn });
    assert.equal(result.code, 0, line.join(" "));
    assert.match(result.stdout, /^ok: true\nsent: false\nsaved_as: draft\naxi_notice: .*Nothing was sent/m, line.join(" "));
    assert.match(result.stderr, /hey-axi: Saved as a DRAFT\. Nothing was sent\./, line.join(" "));
  }
  assert.deepEqual(await fake.calls(), [
    "compose --to a@example.com --subject Hi -m hello --draft --json",
    "reply 123 -m thanks --draft --json",
  ]);
  await fake.cleanup();
});

test("--json output also carries the not-sent marker", async () => {
  const fake = await makeFakeHey({ stdout: '{"ok":true,"data":{"draft_id":9}}' });
  const result = await runAxi([...sendLines[0], "--json"], { fake, env: noOptIn });
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.sent, false);
  assert.equal(parsed.saved_as, "draft");
  assert.deepEqual(parsed.data, { draft_id: 9 });
  await fake.cleanup();
});

test("raw output modes are staged as drafts too", async () => {
  const fake = await makeFakeHey({ stdout: "draft 9\n" });
  const result = await runAxi([...sendLines[0], "--markdown"], { fake, env: noOptIn });
  assert.equal(result.code, 0);
  assert.match(result.stderr, /Saved as a DRAFT/);
  assert.deepEqual(await fake.calls(), ["compose --to a@example.com --subject Hi -m hello --markdown --draft"]);
  await fake.cleanup();
});

test("send commands with no draft mode are refused with an explanation, HEY never invoked", async () => {
  const fake = await makeFakeHey();
  const expectations = [
    [sendLines[2], /no draft mode for forward/, /hey-axi reply <id>/],
    [sendLines[3], /delivers an existing draft/, /hey-axi draft show <id>/],
    [sendLines[4], /no draft mode for bulk replies/, /bulk-reply preview/],
  ];
  for (const [line, reason, hint] of expectations) {
    const result = await runAxi(line, { fake, env: noOptIn });
    assert.equal(result.code, 2, line.join(" "));
    assert.match(result.stdout, /error: send blocked/);
    assert.match(result.stdout, reason);
    assert.match(result.stdout, hint);
    assert.match(result.stdout, /--allow-send/);
  }
  // Raw output selectors don't bypass the gate.
  assert.equal((await runAxi([...sendLines[2], "--markdown"], { fake, env: noOptIn })).code, 2);
  assert.deepEqual(await fake.calls(), []);
  await fake.cleanup();
});

test("explicitly staged sends (compose --draft, reply --draft/--dry-run) pass through unchanged", async () => {
  const fake = await makeFakeHey({ stdout: '{"ok":true,"data":{"draft_id":9}}' });
  for (const line of [
    ["compose", "--to", "a@example.com", "-m", "hello", "--draft"],
    ["reply", "123", "-m", "thanks", "--draft"],
    ["reply", "123", "--dry-run"],
  ]) {
    const result = await runAxi(line, { fake, env: noOptIn });
    assert.equal(result.code, 0, line.join(" "));
    assert.doesNotMatch(result.stdout, NOT_SENT, "no auto-staging marker when the user staged it");
  }
  assert.deepEqual(await fake.calls(), [
    "compose --to a@example.com -m hello --draft --json",
    "reply 123 -m thanks --draft --json",
    "reply 123 --dry-run --json",
  ]);
  await fake.cleanup();
});

test("--allow-send opts in, adds no --draft, and is not forwarded to HEY", async () => {
  const fake = await makeFakeHey({ stdout: '{"ok":true,"data":{"sent":true}}' });
  for (const line of sendLines) {
    const result = await runAxi([...line, "--allow-send"], { fake, env: noOptIn });
    assert.equal(result.code, 0, line.join(" "));
    assert.doesNotMatch(result.stdout, NOT_SENT);
  }
  const calls = await fake.calls();
  assert.equal(calls.length, sendLines.length);
  for (const call of calls) assert.doesNotMatch(call, /allow-send|--draft/);
  assert.equal(calls[3], "draft send 77 --json");
  await fake.cleanup();
});

test("HEY_AXI_ALLOW_SEND=1 opts in for the whole process", async () => {
  const fake = await makeFakeHey();
  for (const line of [sendLines[0], sendLines[2]]) {
    assert.equal((await runAxi(line, { fake, env: { HEY_AXI_ALLOW_SEND: "1" } })).code, 0);
  }
  assert.deepEqual(await fake.calls(), ["compose --to a@example.com --subject Hi -m hello --json", "forward 123 --to b@example.com --json"]);
  await fake.cleanup();
});

test("auth token requires --allow-secret", async () => {
  const fake = await makeFakeHey({ stdout: '{"ok":true,"data":{"token":"fake"}}' });
  const refused = await runAxi(["auth", "token"], { fake, env: noOptIn });
  assert.equal(refused.code, 2);
  assert.match(refused.stdout, /secret output blocked/);
  assert.deepEqual(await fake.calls(), []);
  const allowed = await runAxi(["auth", "token", "--allow-secret"], { fake, env: noOptIn });
  assert.equal(allowed.code, 0);
  assert.deepEqual(await fake.calls(), ["auth token --json"]);
  await fake.cleanup();
});

test("send-command help explains drafting and the gate without invoking HEY", async () => {
  const fake = await makeFakeHey();
  const compose = await runAxi(["compose", "--help"], { fake, env: noOptIn });
  assert.equal(compose.code, 0);
  assert.match(compose.stdout, /hey-axi adds --draft: it's saved as a draft, not sent/);
  const forward = await runAxi(["forward", "--help"], { fake, env: noOptIn });
  assert.match(forward.stdout, /send blocked: this command delivers email, and HEY has no draft mode/);
  assert.deepEqual(await fake.calls(), []);
  await fake.cleanup();
});
