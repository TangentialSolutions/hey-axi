import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function runAxi(args, env) {
  return new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", ...args], { env },
    (error, stdout, stderr) => resolve({ error, stdout, stderr })));
}

function envWithout(...names) {
  const env = { ...process.env };
  for (const name of names) delete env[name];
  return env;
}

test("finds `hey` on PATH when HEY_BIN is not set", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hey-axi-path-"));
  const fakeHey = join(directory, "hey");
  const argsFile = join(directory, "args");
  await writeFile(fakeHey, `#!/bin/sh
printf '%s\\n' "$*" > "${argsFile}"
printf '%s' '{"version":"1.7.0","source":"release"}'
`);
  await chmod(fakeHey, 0o755);
  const env = envWithout("HEY_BIN");
  env.PATH = `${directory}:${process.env.PATH}`;
  const result = await runAxi(["version"], env);
  assert.equal(result.error, null, result.stdout);
  assert.match(result.stdout, /1\.7\.0/);
  assert.equal((await readFile(argsFile, "utf8")).trim(), "version --json");
  await rm(directory, { recursive: true, force: true });
});

test("HEY_BIN takes precedence over PATH", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hey-axi-path-"));
  const onPath = join(directory, "hey");
  const explicit = join(directory, "explicit-hey");
  await writeFile(onPath, `#!/bin/sh\nprintf '%s' '{"which":"path"}'\n`);
  await writeFile(explicit, `#!/bin/sh\nprintf '%s' '{"which":"explicit"}'\n`);
  await chmod(onPath, 0o755);
  await chmod(explicit, 0o755);
  const env = { ...process.env, HEY_BIN: explicit, PATH: `${directory}:${process.env.PATH}` };
  const result = await runAxi(["version"], env);
  assert.equal(result.error, null);
  assert.match(result.stdout, /explicit/);
  await rm(directory, { recursive: true, force: true });
});

test("reports a structured, actionable error when HEY is not installed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hey-axi-empty-"));
  const env = envWithout("HEY_BIN");
  env.PATH = directory;
  const result = await runAxi(["version"], env);
  assert.equal(result.error.code, 127);
  assert.match(result.stdout, /ok: false/);
  assert.match(result.stdout, /HEY CLI not found on PATH/);
  assert.match(result.stdout, /exit_code: 127/);
  assert.doesNotMatch(result.stdout, /\/Users\//);
  await rm(directory, { recursive: true, force: true });
});

test("names HEY_BIN in the error when the explicit binary is missing", async () => {
  const result = await runAxi(["version"], { ...process.env, HEY_BIN: "/nonexistent/hey" });
  assert.equal(result.error.code, 127);
  assert.match(result.stdout, /HEY_BIN=\/nonexistent\/hey/);
});

test("source no longer hardcodes a developer-specific path", async () => {
  const source = await readFile("src/hey-axi.js", "utf8");
  assert.doesNotMatch(source, /\/Users\/trevorbroaddus/);
});
