#!/usr/bin/env node
// Upstream drift check: does src/manifest.json still match the commands and flags HEY has
// on basecamp/hey-cli main (or another ref)? Exits 1 with a readable diff when it doesn't.
//
//   npm run check-drift                         # clone basecamp/hey-cli main, build it (needs Go), compare
//   node scripts/check-drift.js --ref v1.8.0    # any branch or tag
//   node scripts/check-drift.js --source ../hey-cli   # an existing checkout (built here)
//   node scripts/check-drift.js --hey ./hey --commit <sha>   # an already built binary
//   node scripts/check-drift.js --write         # also rewrite src/manifest.json from it
//   node scripts/check-drift.js --strict        # help-text changes fail too
//
// Commands, flags (name, shorthand, value/type, default), USAGE lines and shortcut forms
// are compared: what an agent can type. Help-text-only changes (descriptions, notes,
// examples) are listed but only fail with --strict.
//
// HEY is only asked for `hey version`, `hey commands` and `hey <command> --help`, under a
// throwaway HOME: no login, no mailbox access.

import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateManifest, serialize, surfaceDiff, textDiff } from "./manifest-lib.js";

const REPO = "https://github.com/basecamp/hey-cli.git";
const target = fileURLToPath(new URL("../src/manifest.json", import.meta.url));

function parseOptions(argv) {
  const options = { ref: "main" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      if (argv[i + 1] === undefined) throw new Error(`${arg} needs a value`);
      i += 1;
      return argv[i];
    };
    if (arg === "--ref") options.ref = value();
    else if (arg === "--source") options.source = value();
    else if (arg === "--hey") options.hey = value();
    else if (arg === "--commit") options.commit = value();
    else if (arg === "--commit-date") options.commitDate = value();
    else if (arg === "--base") options.base = value();
    else if (arg === "--manifest") options.manifest = value();
    else if (arg === "--write") options.write = true;
    else if (arg === "--strict") options.strict = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`unknown option ${arg}`);
  }
  return options;
}

const git = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

// Commit, date and the release it builds on, for the manifest's label.
function describeCheckout(dir) {
  const info = { commit: git(dir, "rev-parse", "HEAD"), commitDate: git(dir, "log", "-1", "--format=%cs") };
  try {
    info.exactTag = git(dir, "describe", "--tags", "--exact-match", "--match", "v*");
  } catch {
    // not a release commit
  }
  try {
    info.base = git(dir, "describe", "--tags", "--abbrev=0", "--match", "v*");
  } catch {
    // no tags fetched
  }
  return info;
}

function build(dir, out) {
  process.stderr.write(`building hey from ${dir} ...\n`);
  execFileSync("go", ["build", "-o", out, "./cmd/hey"], { cwd: dir, stdio: ["ignore", "inherit", "inherit"] });
}

function label({ ref, commit, commitDate, base, exactTag }) {
  const short = commit ? commit.slice(0, 7) : "unknown";
  if (exactTag) return { version: exactTag.replace(/^v/, ""), commit, commit_date: commitDate, source: `hey commands --json + hey <command> --help (basecamp/hey-cli ${exactTag})` };
  const version = `${base ? base.replace(/^v/, "") : "0.0.0"}+${String(ref).replace(/[^\w.-]+/g, "-")}.${short}`;
  return { version, commit, commit_date: commitDate, source: `hey commands --json + hey <command> --help (basecamp/hey-cli ${ref} at ${short}${commitDate ? `, ${commitDate}` : ""}; unreleased, built from source)` };
}

function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").filter((line) => line.startsWith("//")).map((line) => line.slice(3)).join("\n") + "\n");
    return 0;
  }
  const work = mkdtempSync(join(tmpdir(), "hey-axi-drift-"));
  try {
    let hey = options.hey && resolve(options.hey);
    let info = { ref: options.ref, commit: options.commit, commitDate: options.commitDate, base: options.base };
    if (!hey) {
      let dir = options.source && resolve(options.source);
      if (!dir) {
        dir = join(work, "hey-cli");
        process.stderr.write(`cloning ${REPO} (${options.ref}) ...\n`);
        execFileSync("git", ["clone", "--quiet", "--filter=blob:none", "--branch", options.ref, REPO, dir], { stdio: ["ignore", "inherit", "inherit"] });
      }
      info = { ...info, ...describeCheckout(dir), ...(options.base ? { base: options.base } : {}) };
      hey = join(work, "hey");
      build(dir, hey);
    }
    const home = join(work, "home");
    const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_CACHE_HOME: join(home, ".cache"), HEY_NONINTERACTIVE: "1", NO_COLOR: "1" };
    const theirs = generateManifest(hey, { env, label: label(info) });
    const oursPath = options.manifest ? resolve(options.manifest) : target;
    const ours = JSON.parse(readFileSync(oursPath, "utf8"));

    const surface = surfaceDiff(ours, theirs);
    const text = textDiff(ours, theirs);
    const out = [];
    out.push(`ours:     ${ours.hey_version} (${ours.hey_commit || "no commit"})`);
    out.push(`upstream: ${theirs.hey_version} (${theirs.hey_commit || "no commit"})`);
    if (surface.length) {
      out.push("", `commands/flags differ (${surface.length}):`, ...surface.map((line) => `  ${line}`));
    } else out.push("", "commands/flags: identical");
    if (text.length) out.push("", `help text differs for ${text.length} command(s):`, ...text.map((line) => `  ${line}`));
    const failed = surface.length > 0 || (options.strict && text.length > 0);
    if (failed && !options.write) out.push("", "To update: npm run manifest:main (or node scripts/check-drift.js --write), review `git diff src/manifest.json`, then classify any new command in src/policy.js and add tests.");
    process.stdout.write(`${out.join("\n")}\n`);

    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## HEY upstream drift\n\n\`\`\`\n${out.join("\n")}\n\`\`\`\n`);
    if (failed && process.env.GITHUB_ACTIONS) process.stdout.write(`::error title=HEY drift::src/manifest.json differs from basecamp/hey-cli ${info.ref}: ${surface.length} command/flag change(s)${options.strict ? `, ${text.length} help-text change(s)` : ""}\n`);
    if (options.write) {
      writeFileSync(target, serialize(theirs));
      process.stdout.write(`wrote ${target} from hey ${theirs.hey_version}\n`);
      return 0;
    }
    return failed ? 1 : 0;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`check-drift: ${error.message}\n`);
  process.exitCode = 2;
}
