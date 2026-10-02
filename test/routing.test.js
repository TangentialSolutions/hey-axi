import test from "node:test";
import assert from "node:assert/strict";
import { loadBundledManifest, listCommands } from "../src/router.js";
import { blockedPaths } from "../src/policy.js";
import { makeFakeHey, runAxi } from "./helpers.js";

const manifest = loadBundledManifest();
const blocked = new Set(blockedPaths());

test("routes every non-blocked manifest command to HEY with its argv intact", async () => {
  const fake = await makeFakeHey({ stdout: '{"ok":true,"data":{"done":true}}' });
  const runnable = listCommands(manifest.commands).filter((node) => !blocked.has(node.path));
  assert.ok(runnable.length >= 130, `only ${runnable.length} routable`);
  const expected = [];
  for (let i = 0; i < runnable.length; i += 16) {
    const batch = runnable.slice(i, i + 16);
    const results = await Promise.all(batch.map((node) => runAxi([...node.path.split(" "), "123", "--limit", "5"], { fake })));
    results.forEach((result, index) => {
      assert.equal(result.code, 0, `${batch[index].path}: ${result.stdout}`);
      assert.match(result.stdout, /done: true/, batch[index].path);
    });
    expected.push(...batch.map((node) => `${node.path} 123 --limit 5 --json --quiet`));
  }
  assert.deepEqual((await fake.calls()).sort(), expected.sort());
  await fake.cleanup();
});

test("blocked commands are refused without invoking HEY", async () => {
  const fake = await makeFakeHey();
  for (const path of blocked) {
    const result = await runAxi([...path.split(" "), "--to", "someone@example.com", "-m", "hi"], { fake });
    assert.equal(result.code, 2, path);
    assert.match(result.stdout, /unsupported command/, path);
  }
  assert.deepEqual(await fake.calls(), []);
  await fake.cleanup();
});

test("shortcut forms forward exactly what was typed", async () => {
  const fake = await makeFakeHey();
  for (const line of ["box imbox", "label 9 --all", "workflow 65", "collection 3", "bundle 12"]) {
    assert.equal((await runAxi(line.split(" "), { fake })).code, 0, line);
  }
  assert.deepEqual(await fake.calls(), [
    "box imbox --json --quiet", "label 9 --all --json --quiet", "workflow 65 --json --quiet",
    "collection 3 --json --quiet", "bundle 12 --json --quiet",
  ]);
  await fake.cleanup();
});

test("account list, auth status, commands and version keep user flags", async () => {
  const fake = await makeFakeHey();
  for (const line of ["account list --account 2", "auth status --account 2", "commands --stats", "version --stats"]) {
    assert.equal((await runAxi(line.split(" "), { fake })).code, 0, line);
  }
  assert.deepEqual(await fake.calls(), [
    "account list --account 2 --json --quiet", "auth status --account 2 --json --quiet",
    "commands --stats --json --quiet", "version --stats --json --quiet",
  ]);
  await fake.cleanup();
});

test("incomplete group commands fail with the available subcommands", async () => {
  const fake = await makeFakeHey();
  const result = await runAxi(["timetrack"], { fake });
  assert.equal(result.code, 2);
  assert.match(result.stdout, /incomplete command/);
  assert.match(result.stdout, /subcommands\[\d+\]: .*current/);
  assert.deepEqual(await fake.calls(), []);
  await fake.cleanup();
});

test("discovers commands newer than the bundled manifest from the installed HEY", async () => {
  const fake = await makeFakeHey({
    stdout: '{"ok":true,"data":[{"id":1}]}',
    catalog: [{ name: "newsletter", path: "newsletter", short: "x", subcommands: [{ name: "list", path: "newsletter list", short: "List" }] }],
  });
  const result = await runAxi(["newsletter", "list", "--all"], { fake });
  assert.equal(result.code, 0, result.stdout);
  assert.deepEqual(await fake.calls(), ["commands --json --quiet", "newsletter list --all --json --quiet"]);
  const unknown = await runAxi(["nonsense"], { fake });
  assert.equal(unknown.code, 2);
  assert.match(unknown.stdout, /unknown command/);
  await fake.cleanup();
});

test("per-command --help comes from the manifest and never invokes HEY", async () => {
  const fake = await makeFakeHey();
  const result = await runAxi(["set-aside", "group", "view", "--help"], { fake });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /hey-axi set-aside group view/);
  assert.match(result.stdout, /--page <value>/);
  const group = await runAxi(["box", "--help"], { fake });
  assert.match(group.stdout, /shortcut: hey-axi box <name\|id>/);
  assert.deepEqual(await fake.calls(), []);
  await fake.cleanup();
});

test("top-level help lists every HEY command group", async () => {
  const result = await runAxi(["--help"]);
  for (const node of manifest.commands) assert.match(result.stdout, new RegExp(`^  ${node.name}[ |]`, "m"), node.name);
});
