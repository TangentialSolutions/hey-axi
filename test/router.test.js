import test from "node:test";
import assert from "node:assert/strict";
import { loadBundledManifest, resolveCommand, listCommands, normalizeCatalog, isRunnable } from "../src/router.js";

const manifest = loadBundledManifest();
const resolve = (line) => resolveCommand(manifest.commands, line.split(" "));

test("bundled manifest is a snapshot of `hey commands --json` + per-command help from HEY main after v1.7.0", () => {
  assert.match(manifest.source, /^hey commands --json \+ hey <command> --help \(basecamp\/hey-cli main at 8bf9310, 2026-10-03; unreleased, built from source\)$/);
  assert.equal(manifest.hey_version, "1.7.0+main.8bf9310");
  assert.equal(manifest.hey_commit, "8bf9310c0b1df7448e39ed1f81826ae795bd8b5c");
  assert.equal(manifest.hey_commit_date, "2026-10-03");
  assert.equal(manifest.commands.length, 49);
});

test("every runnable command in the manifest resolves to itself", () => {
  const runnable = listCommands(manifest.commands);
  // 145 canonical commands (v1.7.0's 144 + contact deliver from HEY main) + 2 aliases
  // (login, logout) + 5 shortcut groups + 3 groups HEY also runs on their own
  // (set-aside, set-aside group, skill).
  assert.equal(runnable.length, 155);
  for (const node of runnable) {
    const result = resolve(node.path);
    assert.equal(result.error, undefined, node.path);
    assert.equal(result.path, node.path);
    assert.equal(result.consumed, node.path.split(" ").length);
  }
});

test("resolves three-word commands", () => {
  assert.equal(resolve("set-aside group view 42").path, "set-aside group view");
  assert.equal(resolve("workflow stage update 65").path, "workflow stage update");
  assert.equal(resolve("contact note show 7").path, "contact note show");
  assert.equal(resolve("timetrack category create Writing").path, "timetrack category create");
});

test("resolves documented shortcut forms to their group", () => {
  for (const [line, path] of [["box imbox", "box"], ["bundle 12", "bundle"], ["collection 3", "collection"], ["label 9", "label"], ["workflow 65", "workflow"]]) {
    const result = resolve(line);
    assert.equal(result.path, path, line);
    assert.equal(result.consumed, 1, line);
  }
});

test("prefers a real subcommand over the shortcut argument", () => {
  assert.equal(resolve("box view imbox").path, "box view");
  assert.equal(resolve("label list").path, "label list");
});

test("treats free-text after a flag-bearing group as arguments", () => {
  assert.equal(resolve("search quarterly planning").path, "search");
  assert.equal(resolve("search filters").path, "search filters");
});

test("reports incomplete and unknown subcommands with suggestions", () => {
  const incomplete = resolve("contact");
  assert.equal(incomplete.error, "incomplete command");
  assert.ok(incomplete.subcommands.includes("show"));
  const unknown = resolve("contact frobnicate");
  assert.equal(unknown.error, "unknown subcommand");
  assert.equal(unknown.word, "frobnicate");
  assert.equal(resolve("wat").error, "unknown command");
});

test("normalizeCatalog marks value-taking flags and keeps every default, including zero/false/empty", () => {
  const [node] = normalizeCatalog([{ name: "x", flags: [
    { name: "all", default: "false" }, { name: "limit", default: "0" }, { name: "to", default: "[]", shorthand: "t" }, { name: "help", default: "false" },
  ] }]);
  assert.deepEqual(node.flags, [{ name: "all", default: "false" }, { name: "limit", value: true, type: "string", default: "0" }, { name: "to", shorthand: "t", value: true, type: "string", default: "[]" }]);
  assert.equal(isRunnable(node), true);
  const [typed] = normalizeCatalog([{ name: "y", flags: [{ name: "limit", default: "0" }, { name: "verbose", default: "0" }] }], { "y --limit": "int", "y --verbose": "count" });
  assert.deepEqual(typed.flags, [{ name: "limit", value: true, type: "int", default: "0" }, { name: "verbose", type: "count", default: "0" }]);
});

test("every manifest flag states its default and value type", () => {
  for (const node of listCommands(manifest.commands)) {
    for (const flag of node.flags || []) {
      assert.notEqual(flag.default, undefined, `${node.path} --${flag.name}`);
      if (flag.value) assert.ok(flag.type, `${node.path} --${flag.name} has no type`);
    }
  }
});
