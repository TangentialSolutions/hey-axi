import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

test("delegates read-only box commands and renders the JSON envelope as TOON", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hey-axi-"));
  const fakeHey = join(directory, "hey");
  await writeFile(fakeHey, `#!/bin/sh
printf '%s\n' "$*" > "$HEY_ARGS_FILE"
printf '%s' '{"ok":true,"data":[{"id":123,"name":"Imbox"}]}'
`);
  await execFile(process.env.SHELL || "/bin/sh", ["-c", `chmod +x "$1"`, "sh", fakeHey]);
  const argsFile = join(directory, "args");
  const result = await new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", "box", "list", "--limit", "5"], {
    env: { ...process.env, HEY_BIN: fakeHey, HEY_ARGS_FILE: argsFile },
  }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error, null);
  assert.match(result.stdout, /data\[1\]\{id,name\}/);
  assert.match(result.stdout, /123,Imbox/);
  const forwarded = await import("node:fs/promises").then(({ readFile }) => readFile(argsFile, "utf8"));
  assert.equal(forwarded.trim(), "box list --limit 5 --json --quiet");
  await rm(directory, { recursive: true, force: true });
});
