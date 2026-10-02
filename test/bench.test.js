import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { READ_ONLY_PATHS, benchCommands } from "../bench/commands.mjs";
import { startMockHeyApi } from "../bench/lib/mock-hey-api.mjs";

const run = (args) => new Promise((resolve) => execFile(process.execPath, args, { maxBuffer: 1 << 24 },
  (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr })));

test("benchmark commands are all on the read-only allowlist", () => {
  for (const command of benchCommands()) assert.ok(READ_ONLY_PATHS.has(command.path), command.path);
  for (const mutating of ["compose", "reply", "seen", "move", "trash", "label add"]) assert.ok(!READ_ONLY_PATHS.has(mutating));
});

test("mock HEY API serves synthetic fixtures over GET and refuses everything else", async () => {
  const mock = await startMockHeyApi({ notFound: ["/topics/999999"] });
  try {
    const boxes = await fetch(`${mock.url}/boxes.json`);
    assert.equal(boxes.status, 200);
    assert.equal((await boxes.json()).length, 6);
    assert.equal((await fetch(`${mock.url}/topics/50000/entries.json`)).status, 200);
    assert.equal((await fetch(`${mock.url}/topics/999999/entries.json`)).status, 404);
    assert.equal((await fetch(`${mock.url}/topics/1/messages`, { method: "POST", body: "{}" })).status, 405);
  } finally {
    await mock.close();
  }
});

test("token benchmark runs on the checked-in synthetic captures", async () => {
  const result = await run(["bench/tokens.mjs", "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const { real, rows } = JSON.parse(result.stdout);
  assert.equal(real, false);
  assert.equal(rows.length, 9);
  for (const row of rows) {
    assert.equal(row.synthetic, true, row.command);
    for (const encoding of ["o200k_base", "cl100k_base"]) {
      const t = row.tokens[encoding];
      for (const value of Object.values(t)) assert.ok(value > 0, `${row.command} ${encoding}`);
      // Errors gain an actionable `help` line, so they may be a few tokens larger.
      if (!row.command.startsWith("error")) assert.ok(t.axi_toon < t.hey_json, `${row.command}: TOON should beat pretty hey --json`);
      assert.ok(t.axi_toon <= t.axi_full, `${row.command}: default should not exceed --full`);
    }
  }
  const error = rows.find((row) => row.command.startsWith("error"));
  assert.ok(error.bytes.axi_toon > 0);
});

test("docs/benchmarks.md results match a fresh run", async () => {
  const fresh = await run(["bench/tokens.mjs"]);
  const doc = await readFile("docs/benchmarks.md", "utf8");
  const block = doc.split("<!-- bench:results:start -->\n")[1].split("\n<!-- bench:results:end -->")[0];
  assert.equal(block.trim(), fresh.stdout.trim(), "run `npm run bench:tokens -- --write` and commit");
});
