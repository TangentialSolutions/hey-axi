#!/usr/bin/env node
// Regenerate src/manifest.json from the installed HEY CLI's own command catalog.
//
//   npm run refresh-manifest              # uses HEY_BIN or `hey` on PATH
//   HEY_BIN=/path/to/hey npm run refresh-manifest
//
// Only `hey version --json`, `hey commands --json` and `hey <command> --help` are run.
// None of them needs a login or touches a mailbox.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeCatalog } from "../src/router.js";

const HEY = process.env.HEY_BIN || "hey";
const target = fileURLToPath(new URL("../src/manifest.json", import.meta.url));

function heyJSON(args) {
  const stdout = execFileSync(HEY, [...args, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  const parsed = JSON.parse(stdout);
  return parsed && typeof parsed === "object" && "data" in parsed ? parsed.data : parsed;
}

// USAGE, EXAMPLES and flag value types only exist in each command's --help text.
// `--help` is answered locally by HEY (no login, no network).
function parseHelp(text) {
  const section = (name) => {
    const match = text.match(new RegExp(`^${name}\\n((?:  .*\\n?)+)`, "m"));
    return match ? match[1].split("\n").map((line) => line.trim()).filter(Boolean) : [];
  };
  const types = {};
  for (const line of section("FLAGS")) {
    const match = line.match(/^(?:-\w, )?--([\w-]+)(?: (\w+))?(?:\s{2,}|$)/);
    if (match && match[2]) types[match[1]] = match[2];
  }
  return { synopsis: section("USAGE"), examples: section("EXAMPLES").filter((line) => line.startsWith("hey ")).slice(0, 3), types };
}

const help = new Map();
function readHelp(nodes) {
  for (const node of nodes || []) {
    const path = node.path || node.name;
    const text = execFileSync(HEY, [...path.split(" "), "--help"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    help.set(path, parseHelp(text));
    readHelp(node.subcommands);
  }
}

function addHelp(nodes) {
  for (const node of nodes) {
    const { synopsis, examples } = help.get(node.path);
    if (synopsis.length) node.synopsis = synopsis;
    if (examples.length) node.examples = examples;
    if (node.subcommands) addHelp(node.subcommands);
  }
}

const version = heyJSON(["version"]);
const catalog = heyJSON(["commands"]);
readHelp(catalog);
const types = {};
for (const [path, { types: flagTypes }] of help) for (const [flag, type] of Object.entries(flagTypes)) types[`${path} --${flag}`] = type;
const commands = normalizeCatalog(catalog, types);
addHelp(commands);
const manifest = {
  source: "hey commands --json + hey <command> --help",
  hey_version: version.version,
  hey_commit: version.commit,
  commands,
};
writeFileSync(target, `${JSON.stringify(manifest, null, 1)}\n`);
process.stdout.write(`wrote ${target} from hey ${version.version} (${manifest.commands.length} top-level commands)\n`);
