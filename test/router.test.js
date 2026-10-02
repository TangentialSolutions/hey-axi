import test from "node:test";
import assert from "node:assert/strict";
import { loadBundledManifest, resolveCommand, listCommands, normalizeCatalog, isRunnable } from "../src/router.js";

const manifest = loadBundledManifest();
const resolve = (line) => resolveCommand(manifest.commands, line.split(" "));

test("bundled manifest is a v1.7.0 snapshot of `hey commands --json` + per-command help", () => {
  assert.equal(manifest.source, "hey commands --json + hey <command> --help");
  assert.equal(manifest.hey_version, "1.7.0");
  assert.equal(manifest.commands.length, 49);
});

test("every runnable command in the manifest resolves to itself", () => {
  const runnable = listCommands(manifest.commands);
  // 144 canonical commands + 2 aliases (login, logout) + 5 shortcut groups.
  assert.equal(runnable.length, 151);
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

test("normalizeCatalog marks value-taking flags from their defaults", () => {
  const [node] = normalizeCatalog([{ name: "x", flags: [
    { name: "all", default: "false" }, { name: "limit", default: "0" }, { name: "to", default: "[]", shorthand: "t" }, { name: "help", default: "false" },
  ] }]);
  assert.deepEqual(node.flags, [{ name: "all" }, { name: "limit", value: true }, { name: "to", shorthand: "t", value: true }]);
  assert.equal(isRunnable(node), true);
});
