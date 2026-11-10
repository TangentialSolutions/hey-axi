// HEY v1.12.0+ (#627): thread read entries may carry the thread's topic_id and
// screened_in. Fake HEY only.
import test from "node:test";
import assert from "node:assert/strict";
import { makeFakeHey, runAxi } from "./helpers.js";
import { DETAIL_FIELDS, shapeEnvelope, threadScreenedHelp } from "../src/shape.js";

const ENTRY = {
  id: 501,
  topic_id: 12345,
  screened_in: true,
  created_at: "2026-11-08T18:00:00Z",
  creator: { name: "Ann", email_address: "ann@example.com" },
  recipients: { to: [{ email_address: "you@example.com" }], cc: [] },
  body: "Hello",
  app_url: "https://app.hey.com/topics/12345",
};

function envelope(entries, extra = {}) {
  return JSON.stringify({
    ok: true,
    data: entries,
    summary: `${entries.length} entries`,
    breadcrumbs: [{ action: "reply", command: "hey reply 12345", description: "Reply to this thread" }],
    ...extra,
  });
}

test("thread read default fields include topic_id and screened_in, after id", () => {
  const fields = DETAIL_FIELDS["thread read"].map((spec) => spec.split("=")[0]);
  assert.deepEqual(fields.slice(0, 3), ["id", "topic_id", "screened_in"]);
  assert.ok(fields.includes("body"));
});

test("thread read shows topic_id and screened_in, keeps HEY's next-command hint, and drops app_url", async () => {
  const fake = await makeFakeHey({ stdout: envelope([ENTRY]) });
  const result = await runAxi(["thread", "read", "12345"], { fake });
  assert.equal(result.code, 0, result.stdout);
  assert.match(result.stdout, /data\[1\]\{id,topic_id,screened_in,at,from,email,to,body\}:/);
  assert.match(result.stdout, /501,12345,true,"2026-11-08T18:00:00Z",Ann,ann@example.com,you@example.com,Hello/);
  assert.match(result.stdout, /Run `hey-axi reply 12345` to reply to this thread/);
  assert.doesNotMatch(result.stdout, /app_url/);
  assert.doesNotMatch(result.stdout, /Screener/);
  await fake.cleanup();
});

test("screened_in: false adds a Screener hint that carries --account; true or missing does not", async () => {
  const waiting = { ...ENTRY, screened_in: false };
  const fake = await makeFakeHey({ stdout: envelope([waiting]) });
  const result = await runAxi(["--account", "5", "thread", "read", "12345"], { fake });
  assert.equal(result.code, 0, result.stdout);
  assert.match(result.stdout, /screened_in: false/);
  assert.match(result.stdout, /This thread has screened_in: false: it is waiting in the Screener, or its sender was screened out/);
  assert.match(result.stdout, /Run `hey-axi screener list --account 5` to see the queue/);
  assert.match(result.stdout, /`hey-axi screener approve <id> --account 5` or `hey-axi screener deny <id> --account 5`/);
  // HEY's own breadcrumb is still there.
  assert.match(result.stdout, /Run `hey-axi reply 12345 --account 5` to reply to this thread/);
  await fake.cleanup();

  assert.equal(threadScreenedHelp([{ ...ENTRY, screened_in: true }]), null);
  assert.equal(threadScreenedHelp([{ id: 1, body: "old HEY, no screened_in" }]), null);
  assert.equal(threadScreenedHelp([]), null);
});

test("an older HEY that omits topic_id and screened_in does not invent them or hint", async () => {
  const { topic_id, screened_in, ...legacy } = ENTRY;
  const fake = await makeFakeHey({ stdout: envelope([legacy]) });
  const result = await runAxi(["thread", "read", "12345"], { fake });
  assert.equal(result.code, 0, result.stdout);
  assert.match(result.stdout, /data\[1\]\{id,at,from,email,to,body\}:/);
  assert.doesNotMatch(result.stdout, /topic_id/);
  assert.doesNotMatch(result.stdout, /screened_in/);
  assert.doesNotMatch(result.stdout, /Screener/);
  assert.match(result.stdout, /,Ann,/);
  await fake.cleanup();
});

test("the Screener hint still appears when --fields omits screened_in; --full is HEY's envelope untouched", async () => {
  const waiting = { ...ENTRY, screened_in: false };
  const fake = await makeFakeHey({ stdout: envelope([waiting]) });
  const fields = await runAxi(["thread", "read", "12345", "--fields", "id,body"], { fake });
  assert.equal(fields.code, 0, fields.stdout);
  assert.match(fields.stdout, /data\[1\]\{id,body\}:/);
  assert.doesNotMatch(fields.stdout, /data\[1\]\{[^}]*screened_in/);
  assert.match(fields.stdout, /waiting in the Screener/);
  const full = await runAxi(["thread", "read", "12345", "--full"], { fake });
  assert.equal(full.code, 0, full.stdout);
  // --full is HEY's envelope, so screened_in is in the raw data and hey-axi adds no hint.
  assert.match(full.stdout, /screened_in: false/);
  assert.doesNotMatch(full.stdout, /waiting in the Screener/);
  await fake.cleanup();
});

test("thread read --help lists the new default fields, offline", async () => {
  const result = await runAxi(["thread", "read", "--help"]);
  assert.equal(result.code, 0, result.stdout);
  assert.match(result.stdout, /default fields: id, topic_id, screened_in, at, from, email, to, cc, body/);
  assert.match(result.stdout, /topic_id and screened_in/);
});
