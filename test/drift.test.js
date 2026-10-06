// The upstream drift check (scripts/check-drift.js) with a fake HEY: no network, no Go.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { surfaceDiff, textDiff, parseHelp, serialize } from "../scripts/manifest-lib.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// A HEY with two commands: `contact deliver --to` and `seen`.
function fakeHey(dir, { extraFlag = false } = {}) {
  const catalog = [
    { name: "contact", path: "contact", short: "Manage contacts", subcommands: [
      { name: "deliver", path: "contact deliver", short: "Choose where a contact's email arrives", flags: [{ name: "to", usage: "Delivery destination", default: "" }, ...(extraFlag ? [{ name: "keep-bundle", usage: "Keep the bundle", default: false }] : [])] },
    ] },
    { name: "seen", path: "seen", short: "Mark threads seen" },
  ];
  const help = {
    contact: "USAGE\n  hey contact <command> [flags]\n",
    "contact deliver": `USAGE\n  hey contact deliver <contact-id> [flags]\n\nFLAGS\n      --to string   Delivery destination\n${extraFlag ? "      --keep-bundle   Keep the bundle\n" : ""}\nEXAMPLES\n  hey contact deliver 12345 --to feed\n`,
    seen: "USAGE\n  hey seen <box-item-id>... [flags]\n",
  };
  const bin = join(dir, "hey");
  const quote = (text) => `'${text.replace(/'/g, "'\\''")}'`;
  const cases = Object.entries(help).map(([path, text]) => `  "${path} --help") printf '%s' ${quote(text)} ;;`).join("\n");
  writeFileSync(bin, `#!/bin/sh
case "$*" in
  "version --json") printf '%s' '{"ok":true,"data":{"version":"dev","commit":"none"}}' ;;
  "commands --json") printf '%s' ${quote(JSON.stringify({ ok: true, data: catalog }))} ;;
${cases}
  *) echo "unexpected: $*" >&2; exit 9 ;;
esac
`);
  chmodSync(bin, 0o755);
  return bin;
}

const run = (args) => new Promise((resolve) => execFile(process.execPath, [join(ROOT, "scripts/check-drift.js"), ...args], { env: { ...process.env, GITHUB_ACTIONS: "", GITHUB_STEP_SUMMARY: "" } },
  (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr })));

const ours = {
  hey_version: "1.7.0+main.abc1234", hey_commit: "abc1234",
  commands: [
    { name: "contact", path: "contact", short: "Manage contacts", synopsis: ["hey contact <command> [flags]"], subcommands: [
      { name: "deliver", path: "contact deliver", short: "Choose where a contact's email arrives", flags: [{ name: "to", value: true, type: "string", desc: "Delivery destination", default: "" }], synopsis: ["hey contact deliver <contact-id> [flags]"], examples: ["hey contact deliver 12345 --to feed"] },
    ] },
    { name: "seen", path: "seen", short: "Mark threads seen", synopsis: ["hey seen <box-item-id>... [flags]"] },
  ],
};

test("check-drift passes when HEY's commands and flags match the manifest", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hey-axi-drift-test-"));
  const manifest = join(dir, "manifest.json");
  writeFileSync(manifest, serialize(ours));
  const result = await run(["--hey", fakeHey(dir), "--commit", "abc1234", "--manifest", manifest]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /commands\/flags: identical/);
  rmSync(dir, { recursive: true, force: true });
});

test("check-drift fails with a readable diff when HEY gained or lost a command or flag", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hey-axi-drift-test-"));
  const manifest = join(dir, "manifest.json");
  const stale = structuredClone(ours);
  stale.commands[0].subcommands = [];
  stale.commands.push({ name: "gone", path: "gone", short: "Removed upstream" });
  writeFileSync(manifest, serialize(stale));
  const result = await run(["--hey", fakeHey(dir, { extraFlag: true }), "--commit", "def5678", "--base", "v1.7.0", "--manifest", manifest]);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /^ours: {5}1\.7\.0\+main\.abc1234 \(abc1234\)$/m);
  assert.match(result.stdout, /^upstream: 1\.7\.0\+main\.def5678 \(def5678\)$/m);
  assert.match(result.stdout, /commands\/flags differ \(2\):\n {2}\+ command {2}contact deliver {2}\(flags: --to, --keep-bundle\)\n {2}- command {2}gone/);
  assert.match(result.stdout, /To update: npm run manifest:main/);
  rmSync(dir, { recursive: true, force: true });
});

test("help-text-only changes are listed, and fail only with --strict", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hey-axi-drift-test-"));
  const manifest = join(dir, "manifest.json");
  const wordy = structuredClone(ours);
  wordy.commands[1].short = "Mark email threads seen";
  writeFileSync(manifest, serialize(wordy));
  const bin = fakeHey(dir);
  const loose = await run(["--hey", bin, "--manifest", manifest]);
  assert.equal(loose.code, 0);
  assert.match(loose.stdout, /help text differs for 1 command\(s\):\n {2}seen \(short\)/);
  const strict = await run(["--hey", bin, "--manifest", manifest, "--strict"]);
  assert.equal(strict.code, 1);
  rmSync(dir, { recursive: true, force: true });
});

test("surfaceDiff reports flag changes; parseHelp reads types, usage and examples", () => {
  const changed = structuredClone(ours);
  changed.commands[0].subcommands[0].flags[0].default = "imbox";
  changed.commands[0].subcommands[0].synopsis = ["hey contact deliver <contact-id>... [flags]"];
  assert.deepEqual(surfaceDiff(ours, changed), [
    '~ flag     contact deliver --to default: "" -> "imbox"',
    '~ usage    contact deliver: ["hey contact deliver <contact-id> [flags]"] -> ["hey contact deliver <contact-id>... [flags]"]',
  ]);
  assert.deepEqual(textDiff(ours, ours), []);
  assert.deepEqual(parseHelp("USAGE\n  hey x <id> [flags]\n\nFLAGS\n      --limit int   Max\n  -m, --message string   Body\n\nEXAMPLES\n  hey x 1\n"), { synopsis: ["hey x <id> [flags]"], examples: ["hey x 1"], types: { limit: "int", message: "string" } });
});

test("an unknown option is a usage error (exit 2)", async () => {
  const result = await run(["--bogus"]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /unknown option --bogus/);
});
