import test from "node:test";
import assert from "node:assert/strict";
import { loadBundledManifest, listCommands } from "../src/router.js";
import { destructiveCommands, runMode, sendCommands, userOnlyPaths } from "../src/policy.js";
import { patternsFor } from "../src/arity.js";
import { FLAG_RULES, requiredFlags } from "../src/args.js";
import { makeFakeHey, runAxi } from "./helpers.js";

const manifest = loadBundledManifest();
const special = (path) => runMode(path, new Set()) !== "json";
const gated = new Set([...sendCommands(), "auth token", ...destructiveCommands()]);

// Arguments that satisfy each command's USAGE line, required flags, one-of flag groups
// and content requirements, so every command reaches HEY.
function argsFor(node) {
  const [pattern] = patternsFor(node);
  const positionals = (pattern?.args || []).filter((arg) => arg.required).map(() => "123");
  const typed = (flag) => FLAG_RULES[node.path]?.choices?.[`--${flag.name}`]?.[0] ?? (flag.type === "int" ? "5" : "x");
  const required = requiredFlags(node);
  const flags = [
    ...((node.flags || []).some((flag) => flag.name === "limit") ? ["--limit", "5"] : []),
    ...(node.flags || []).filter((flag) => required.includes(`--${flag.name}`)).flatMap((flag) => [`--${flag.name}`, typed(flag)]),
    ...(pattern?.oneOf || []).map((group) => group[0]).flatMap((flag) => {
      const spec = (node.flags || []).find((candidate) => `--${candidate.name}` === flag);
      return spec?.value ? [flag, "x"] : [flag];
    }),
  ];
  const content = { "contact note set": ["--note", "x"], "journal write": ["--content", "x"], "draft edit": ["--subject", "x"] }[node.path] || [];
  return [...positionals, ...flags, ...content];
}

test("routes every non-blocked manifest command to HEY with its argv intact", async () => {
  const fake = await makeFakeHey({ stdout: '{"ok":true,"data":{"done":true}}' });
  const runnable = listCommands(manifest.commands).filter((node) => !special(node.path) && !gated.has(node.path) && !userOnlyPaths().includes(node.path));
  assert.ok(runnable.length >= 125, `only ${runnable.length} routable`);
  const expected = [];
  for (let i = 0; i < runnable.length; i += 16) {
    const batch = runnable.slice(i, i + 16);
    const results = await Promise.all(batch.map((node) => runAxi([...node.path.split(" "), ...argsFor(node)], { fake })));
    results.forEach((result, index) => {
      assert.equal(result.code, 0, `${batch[index].path}: ${result.stdout}`);
      assert.match(result.stdout, /done: true/, batch[index].path);
    });
    expected.push(...batch.map((node) => [node.path, ...argsFor(node), "--json"].join(" ")));
  }
  assert.deepEqual((await fake.calls()).sort(), expected.sort());
  await fake.cleanup();
});

test("shortcut forms forward exactly what was typed", async () => {
  const fake = await makeFakeHey();
  for (const line of ["box imbox", "label 9 --all", "workflow 65", "collection 3", "bundle 12"]) {
    assert.equal((await runAxi(line.split(" "), { fake })).code, 0, line);
  }
  assert.deepEqual(await fake.calls(), [
    "box imbox --json", "label 9 --all --json", "workflow 65 --json",
    "collection 3 --json", "bundle 12 --json",
  ]);
  await fake.cleanup();
});

test("account list, auth status, commands and version keep user flags", async () => {
  const fake = await makeFakeHey();
  for (const line of ["account list --account 2", "auth status --account 2", "commands --stats", "version --stats"]) {
    assert.equal((await runAxi(line.split(" "), { fake })).code, 0, line);
  }
  assert.deepEqual(await fake.calls(), [
    "account list --account 2 --json", "auth status --account 2 --json",
    "commands --stats --json", "version --stats --json",
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

test("unknown commands fail before HEY runs, with close matches", async () => {
  const fake = await makeFakeHey();
  const unknown = await runAxi(["nonsense"], { fake });
  assert.equal(unknown.code, 2);
  assert.match(unknown.stdout, /unknown command/);
  const typo = await runAxi(["thred", "read", "1"], { fake });
  assert.equal(typo.code, 2);
  assert.match(typo.stdout, /Did you mean `hey-axi thread`\?/);
  const sub = await runAxi(["box", "veiw", "imbox"], { fake });
  assert.equal(sub.code, 2);
  assert.match(sub.stdout, /Did you mean `hey-axi box view`\?/);
  assert.deepEqual(await fake.calls(), []);
  await fake.cleanup();
});

test("per-command --help comes from the manifest and never invokes HEY", async () => {
  const fake = await makeFakeHey();
  const result = await runAxi(["set-aside", "group", "view", "--help"], { fake });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /hey-axi set-aside group view/);
  assert.match(result.stdout, /--page <string>  Continue from a next_page cursor \(default: none\)/);
  const group = await runAxi(["box", "--help"], { fake });
  assert.match(group.stdout, /shortcut: hey-axi box <name\|id>/);
  assert.deepEqual(await fake.calls(), []);
  await fake.cleanup();
});

test("top-level help lists every HEY command group", async () => {
  const result = await runAxi(["--help"]);
  for (const node of manifest.commands) assert.match(result.stdout, new RegExp(`^  ${node.name}[ |]`, "m"), node.name);
});
