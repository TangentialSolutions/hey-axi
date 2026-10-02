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

test("send-type commands are refused without opt-in and HEY is never invoked", async () => {
  const fake = await makeFakeHey();
  for (const line of sendLines) {
    const result = await runAxi(line, { fake, env: noOptIn });
    assert.equal(result.code, 2, line.join(" "));
    assert.match(result.stdout, /error: send blocked/, line.join(" "));
    assert.match(result.stdout, /--allow-send/, line.join(" "));
  }
  // Raw output selectors don't bypass the gate.
  assert.equal((await runAxi(["compose", "--to", "a@example.com", "-m", "x", "--markdown"], { fake, env: noOptIn })).code, 2);
  assert.deepEqual(await fake.calls(), []);
  await fake.cleanup();
});

test("refusal suggests the staging flag when HEY has one", async () => {
  const compose = await runAxi(["compose", "--to", "a@example.com", "-m", "x"], { env: noOptIn });
  assert.match(compose.stdout, /add --draft to stage it/);
  const reply = await runAxi(["reply", "1", "-m", "x"], { env: noOptIn });
  assert.match(reply.stdout, /add --draft or --dry-run/);
});

test("staged sends (compose --draft, reply --draft/--dry-run) run without opt-in", async () => {
  const fake = await makeFakeHey({ stdout: '{"ok":true,"data":{"draft_id":9}}' });
  for (const line of [
    ["compose", "--to", "a@example.com", "-m", "hello", "--draft"],
    ["reply", "123", "-m", "thanks", "--draft"],
    ["reply", "123", "--dry-run"],
  ]) {
    const result = await runAxi(line, { fake, env: noOptIn });
    assert.equal(result.code, 0, line.join(" "));
  }
  assert.deepEqual(await fake.calls(), [
    "compose --to a@example.com -m hello --draft --json",
    "reply 123 -m thanks --draft --json",
    "reply 123 --dry-run --json",
  ]);
  await fake.cleanup();
});

test("--allow-send opts in and is not forwarded to HEY", async () => {
  const fake = await makeFakeHey({ stdout: '{"ok":true,"data":{"sent":true}}' });
  for (const line of sendLines) {
    const result = await runAxi([...line, "--allow-send"], { fake, env: noOptIn });
    assert.equal(result.code, 0, line.join(" "));
  }
  const calls = await fake.calls();
  assert.equal(calls.length, sendLines.length);
  for (const call of calls) assert.doesNotMatch(call, /allow-send/);
  assert.equal(calls[3], "draft send 77 --json");
  await fake.cleanup();
});

test("HEY_AXI_ALLOW_SEND=1 opts in for the whole process", async () => {
  const fake = await makeFakeHey();
  const result = await runAxi(["forward", "123", "--to", "b@example.com"], { fake, env: { HEY_AXI_ALLOW_SEND: "1" } });
  assert.equal(result.code, 0);
  assert.deepEqual(await fake.calls(), ["forward 123 --to b@example.com --json"]);
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

test("send-command help explains the gate without invoking HEY", async () => {
  const fake = await makeFakeHey();
  const result = await runAxi(["compose", "--help"], { fake, env: noOptIn });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /send blocked: this command delivers email/);
  assert.deepEqual(await fake.calls(), []);
  await fake.cleanup();
});
