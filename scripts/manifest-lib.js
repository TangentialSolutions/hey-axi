// Building src/manifest.json from a HEY binary, and comparing two manifests.
// Shared by scripts/refresh-manifest.js and scripts/check-drift.js.
//
// Only `hey version --json`, `hey commands --json` and `hey <command> --help` are run.
// None of them needs a login or touches a mailbox.

import { execFileSync } from "node:child_process";
import { normalizeCatalog } from "../src/router.js";

function heyJSON(hey, args, env) {
  const stdout = execFileSync(hey, [...args, "--json"], { encoding: "utf8", env, stdio: ["ignore", "pipe", "ignore"] });
  const parsed = JSON.parse(stdout);
  return parsed && typeof parsed === "object" && "data" in parsed ? parsed.data : parsed;
}

// USAGE, EXAMPLES and flag value types only exist in each command's --help text.
// `--help` is answered locally by HEY (no login, no network).
export function parseHelp(text) {
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

// The manifest for one HEY binary. `label` overrides what HEY reports about itself
// ({ version, commit, commit_date, source }); a build from source reports "dev".
export function generateManifest(hey, { env = process.env, label = {} } = {}) {
  const version = heyJSON(hey, ["version"], env);
  const catalog = heyJSON(hey, ["commands"], env);
  const help = new Map();
  const readHelp = (nodes) => {
    for (const node of nodes || []) {
      const path = node.path || node.name;
      const text = execFileSync(hey, [...path.split(" "), "--help"], { encoding: "utf8", env, stdio: ["ignore", "pipe", "ignore"] });
      help.set(path, parseHelp(text));
      readHelp(node.subcommands);
    }
  };
  readHelp(catalog);
  const types = {};
  for (const [path, { types: flagTypes }] of help) for (const [flag, type] of Object.entries(flagTypes)) types[`${path} --${flag}`] = type;
  const commands = normalizeCatalog(catalog, types);
  const addHelp = (nodes) => {
    for (const node of nodes) {
      const { synopsis, examples } = help.get(node.path);
      if (synopsis.length) node.synopsis = synopsis;
      if (examples.length) node.examples = examples;
      if (node.subcommands) addHelp(node.subcommands);
    }
  };
  addHelp(commands);
  const manifest = { source: label.source || "hey commands --json + hey <command> --help", hey_version: label.version || version.version, hey_commit: label.commit || version.commit };
  if (label.commit_date) manifest.hey_commit_date = label.commit_date;
  manifest.commands = commands;
  return manifest;
}

export const serialize = (manifest) => `${JSON.stringify(manifest, null, 1)}\n`;

function flatten(nodes, out = new Map()) {
  for (const node of nodes || []) {
    out.set(node.path, node);
    flatten(node.subcommands, out);
  }
  return out;
}

const FLAG_KEYS = ["shorthand", "value", "type", "default"];
const show = (value) => (value === undefined ? "(none)" : JSON.stringify(value));

// What an agent can type: command paths, their flags (name, shorthand, whether it takes a
// value, its type and default), USAGE lines and shortcut forms. Returns readable lines,
// sorted by command: "+ command contact deliver", "- flag box --page", "~ flag ...".
export function surfaceDiff(ours, theirs) {
  const a = flatten(ours.commands);
  const b = flatten(theirs.commands);
  const lines = [];
  for (const path of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const was = a.get(path);
    const now = b.get(path);
    if (!was) {
      const flags = (now.flags || []).map((flag) => `--${flag.name}`).join(", ");
      lines.push(`+ command  ${path}${flags ? `  (flags: ${flags})` : ""}`);
      continue;
    }
    if (!now) {
      lines.push(`- command  ${path}`);
      continue;
    }
    const oldFlags = new Map((was.flags || []).map((flag) => [flag.name, flag]));
    const newFlags = new Map((now.flags || []).map((flag) => [flag.name, flag]));
    for (const [name, flag] of newFlags) {
      if (!oldFlags.has(name)) lines.push(`+ flag     ${path} --${name}${flag.value ? ` <${flag.type || "string"}>` : ""}${flag.desc ? `  ${flag.desc}` : ""}`);
    }
    for (const name of oldFlags.keys()) if (!newFlags.has(name)) lines.push(`- flag     ${path} --${name}`);
    for (const [name, flag] of newFlags) {
      const old = oldFlags.get(name);
      if (!old) continue;
      for (const key of FLAG_KEYS) {
        if (JSON.stringify(old[key]) !== JSON.stringify(flag[key])) lines.push(`~ flag     ${path} --${name} ${key}: ${show(old[key])} -> ${show(flag[key])}`);
      }
    }
    if (JSON.stringify(was.synopsis || []) !== JSON.stringify(now.synopsis || [])) lines.push(`~ usage    ${path}: ${show(was.synopsis)} -> ${show(now.synopsis)}`);
    if ((was.usage || "") !== (now.usage || "")) lines.push(`~ shortcut ${path}: ${show(was.usage)} -> ${show(now.usage)}`);
  }
  return lines;
}

// Help-text-only differences (short description, notes, examples, flag descriptions):
// the command paths whose text changed.
export function textDiff(ours, theirs) {
  const a = flatten(ours.commands);
  const b = flatten(theirs.commands);
  const changed = [];
  for (const [path, now] of b) {
    const was = a.get(path);
    if (!was) continue;
    const fields = [];
    for (const key of ["short", "notes", "examples"]) if (JSON.stringify(was[key]) !== JSON.stringify(now[key])) fields.push(key);
    const oldDesc = new Map((was.flags || []).map((flag) => [flag.name, flag.desc]));
    if ((now.flags || []).some((flag) => oldDesc.has(flag.name) && oldDesc.get(flag.name) !== flag.desc)) fields.push("flag descriptions");
    if (fields.length) changed.push(`${path} (${fields.join(", ")})`);
  }
  return changed.sort();
}
