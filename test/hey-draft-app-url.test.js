// HEY v1.11.0+ (#614): draft save/show answers include app_url, the draft's page in HEY.
// Fake HEY only.
import test from "node:test";
import assert from "node:assert/strict";
import { makeFakeHey, runAxi } from "./helpers.js";
import { shapeData, shapeEnvelope } from "../src/shape.js";

const DRAFT_PAGE = "https://app.hey.com/messages/2201/edit";

const DRAFT_SHOW = {
  id: 2201,
  from: "you@example.com",
  subject: "Lunch plans",
  body: "Are you free Friday?",
  to: ["alice@example.com"],
  app_url: DRAFT_PAGE,
  updated_at: "2026-11-08T18:00:00Z",
};

test("draft show keeps app_url even when the only list is one recipient array", () => {
  // A single primitive array next to other fields used to trip DROP_CONTAINER_KEY
  // and drop app_url. The allowlist keeps the draft's page in HEY.
  const { data } = shapeData(DRAFT_SHOW, { path: "draft show" });
  assert.equal(data.app_url, DRAFT_PAGE);
  assert.equal(data.id, 2201);
  assert.deepEqual(data.to, ["alice@example.com"]);
});

test("compose and reply draft answers, and draft edit, keep app_url; box view still drops it", () => {
  const saved = { id: 2201, app_url: DRAFT_PAGE };
  assert.equal(shapeData(saved, { path: "compose" }).data.app_url, DRAFT_PAGE);
  assert.equal(shapeData(saved, { path: "reply" }).data.app_url, DRAFT_PAGE);
  assert.equal(shapeData({ id: 2201, subject: "Hi", to: ["a@x"], app_url: DRAFT_PAGE }, { path: "draft edit" }).data.app_url, DRAFT_PAGE);

  const box = shapeEnvelope(
    { ok: true, data: { id: 1, kind: "imbox", name: "Imbox", app_url: "https://app.hey.com/imbox", postings: [{ id: 101, topic_id: 501, name: "Hello", creator: { name: "Ann" } }] } },
    { path: "box view", commandLine: "hey-axi box view imbox" },
  );
  assert.equal(box.data.app_url, undefined);
  assert.equal(box.data.postings[0].topic_id, 501);
});

test("draft show and a staged compose keep app_url in output, plus HEY's next-command hint", async () => {
  const fake = await makeFakeHey({
    stdout: JSON.stringify({
      ok: true,
      data: DRAFT_SHOW,
      summary: "Draft 2201",
      breadcrumbs: [{ action: "edit", command: "hey draft edit 2201", description: "Change the draft" }],
    }),
  });
  const show = await runAxi(["draft", "show", "2201"], { fake });
  assert.equal(show.code, 0, show.stdout);
  assert.match(show.stdout, /app_url: "https:\/\/app\.hey\.com\/messages\/2201\/edit"/);
  assert.match(show.stdout, /Run `hey-axi draft edit 2201` to change the draft/);
  await fake.cleanup();

  const compose = await makeFakeHey({
    stdout: JSON.stringify({
      ok: true,
      data: { id: 2201, app_url: DRAFT_PAGE },
      summary: "Draft saved",
      breadcrumbs: [{ action: "show", command: "hey draft show 2201", description: "Read the draft back" }],
    }),
  });
  const staged = await runAxi(["compose", "--to", "alice@example.com", "--subject", "Lunch plans", "-m", "Are you free Friday?"], { fake: compose });
  assert.equal(staged.code, 0, staged.stdout);
  assert.match(staged.stdout, /sent: false/);
  assert.match(staged.stdout, /saved_as: draft/);
  assert.match(staged.stdout, /app_url: "https:\/\/app\.hey\.com\/messages\/2201\/edit"/);
  assert.match(staged.stdout, /Run `hey-axi draft show 2201` to read the draft back/);
  await compose.cleanup();
});
