import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";

test("shows concise help without invoking HEY", async () => {
  const result = await new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", "--help"], (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error, null);
  assert.match(result.stdout, /account list/);
  assert.equal(result.stderr, "");
});

test("rejects unknown commands with a structured error and exit 2", async () => {
  const result = await new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", "wat"], (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error.code, 2);
  assert.match(result.stdout, /unknown command/);
  assert.equal(result.stderr, "");
});
