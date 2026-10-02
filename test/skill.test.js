// Checks the shareable agent skill (skills/hey-axi) against the Agent Skills spec
// (https://agentskills.io/specification) and against hey-axi itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBundledManifest, resolveCommand } from "../src/router.js";
import { renderReference, renderSkill, REFERENCE_PATH } from "../scripts/gen-skill.js";

const SKILL_DIR = fileURLToPath(new URL("../skills/hey-axi/", import.meta.url));
const SKILL_MD = join(SKILL_DIR, "SKILL.md");
const text = readFileSync(SKILL_MD, "utf8");

// Minimal frontmatter reader: top-level `key: value` scalars plus one-level maps.
function frontmatter(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, "SKILL.md must start with YAML frontmatter");
  const data = {};
  let current = null;
  for (const line of match[1].split("\n")) {
    const nested = line.match(/^ {2}([\w-]+):\s*(.*)$/);
    const top = line.match(/^([\w-]+):\s*(.*)$/);
    if (top) {
      current = top[1];
      data[current] = top[2] === "" ? {} : top[2];
    } else if (nested && current && typeof data[current] === "object") {
      data[current][nested[1]] = nested[2];
    } else if (line.trim()) {
      assert.fail(`unexpected frontmatter line: ${line}`);
    }
  }
  return { data, body: source.slice(match[0].length) };
}

const { data, body } = frontmatter(text);

test("skill frontmatter follows the Agent Skills spec", () => {
  assert.match(data.name, /^[a-z0-9]+(-[a-z0-9]+)*$/, "name: lowercase letters, digits, single hyphens");
  assert.ok(data.name.length <= 64);
  assert.equal(data.name, basename(dirname(SKILL_MD)), "name must match the directory");
  assert.equal(typeof data.description, "string");
  assert.ok(data.description.length > 0 && data.description.length <= 1024, `description is ${data.description.length} chars`);
  assert.match(data.description, /Use when /, "description says when to use the skill");
  if (data.compatibility !== undefined) assert.ok(data.compatibility.length <= 500);
  const allowed = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);
  for (const key of Object.keys(data)) assert.ok(allowed.has(key), `unknown frontmatter field ${key}`);
  if (data.metadata !== undefined) {
    for (const value of Object.values(data.metadata)) assert.equal(typeof value, "string");
  }
});

test("skill body stays small and its relative links resolve", () => {
  assert.ok(body.split("\n").length < 500, "keep SKILL.md under 500 lines");
  for (const [, target] of body.matchAll(/\]\(([^)]+)\)/g)) {
    if (/^[a-z]+:/.test(target)) continue;
    assert.ok(existsSync(join(SKILL_DIR, target)), `missing linked file ${target}`);
  }
});

test("every hey-axi command shown in the skill is a real command", () => {
  const { commands } = loadBundledManifest();
  const blocks = [...body.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n");
  const inline = [...body.matchAll(/`(hey-axi [^`]+)`/g)].map((m) => m[1]).join("\n");
  const invocations = `${blocks}\n${inline}`
    .split("\n")
    .flatMap((line) => line.split(/\s{2,}|\s\|\s/))
    .map((part) => part.trim())
    .filter((part) => part.startsWith("hey-axi "));
  assert.ok(invocations.length >= 20, `found ${invocations.length} examples`);
  for (const invocation of invocations) {
    const words = [];
    for (const word of invocation.split(/\s+/).slice(1)) {
      if (/^(-|<|"|#|\.\.\.)/.test(word)) break;
      words.push(word);
    }
    if (words.length === 0) continue; // e.g. `hey-axi --help`
    const resolved = resolveCommand(commands, words);
    assert.ok(!resolved.error, `\`${invocation}\` → ${resolved.error}`);
  }
});

test("references/commands.md is up to date with the manifest", () => {
  assert.equal(readFileSync(REFERENCE_PATH, "utf8"), renderReference(), "run `npm run skill:gen`");
  assert.equal(text, renderSkill(text), "SKILL.md home block is stale: run `npm run skill:gen`");
});
