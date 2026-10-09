import test from "node:test";
import assert from "node:assert/strict";
import { makeFakeHey, runAxi } from "./helpers.js";

// Realistic invocations, as an agent would type them, for the triage mutations and
// read-only commands that hey-axi did not support before the data-driven router.
// (`screener clear` is gated behind --allow-destructive: test/destructive-gate.test.js.)
const TRIAGE = [
  "unseen 1 2", "ignore 1", "stop-ignoring 1", "spam 1 2",
  "label create Receipts 1 2", "label remove 1 2 --from 9",
  "bubble up 1 --tomorrow", "bubble up 1 --on 2026-10-05", "bubble pop 1",
  "collection create Travel --summary trips", "collection add 1 --to 3", "collection remove 1 --from 3", "collection update 3 --name Trips",
  "workflow create Hiring", "workflow update 65 --name Recruiting", "workflow delete 65",
  "workflow add 987 --to 65 --stage 321", "workflow move 987 --workflow 65 --to 322", "workflow remove 987 --from 65",
  "workflow stage create 65", "workflow stage update 65 321 --name Interviewing", "workflow stage delete 65 321",
  "set-aside group create 1 2", "set-aside group add 3 --to 4", "set-aside group remove 3", "set-aside group delete 4",
  "screener approve 55 --box feed --seen", "screener deny 56 --spam",
  "share 1", "unshare 1",
  "clip create 56 --content passage", "clip delete 8",
  "snippet create --name Sched --content Tuesday", "snippet update 4 --name S2", "snippet delete 4",
  "contact add --email a@example.com --name Ann", "contact update 7 --alias Annie", "contact hide 7", "contact show-again 7",
  "contact bundle 7", "contact unbundle 7", "contact note set 7 -n met-at-conf", "contact note delete 7",
  "attachment save 44 -o /tmp/out --force",
  "draft edit 77 --subject New", "draft delete 77", "bulk-reply undo 5",
];

const READ_ONLY = [
  "account senders", "draft show 77", "event day 2026-10-01", "event week", "habit list --date 2026-10-01",
  "screener list --all", "screener history --page 2", "set-aside group list", "set-aside group view 4 --limit 5",
  "timetrack current", "timetrack list --limit 3", "timetrack categories", "contact note show 7", "config show", "doctor",
];

async function expectForwarded(lines) {
  const fake = await makeFakeHey({ stdout: '{"ok":true,"data":{"id":1,"status":"done"}}' });
  for (const line of lines) {
    const result = await runAxi(line.split(" "), { fake });
    assert.equal(result.code, 0, `${line}: ${result.stdout}`);
    assert.match(result.stdout, /status: done/, line);
  }
  assert.deepEqual(await fake.calls(), lines.map((line) => `${line} --json`));
  await fake.cleanup();
}

test("triage mutations route through the new router with argv intact", () => expectForwarded(TRIAGE));
test("previously missing read-only commands route with argv intact", () => expectForwarded(READ_ONLY));
