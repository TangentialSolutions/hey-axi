// Data-driven command routing for hey-axi.
//
// The command tree comes from HEY's own `hey commands --json` catalog, bundled as
// src/manifest.json (refreshed with `npm run refresh-manifest`). Routing never calls
// HEY: an unknown command is rejected before any dependency runs.

import { readFileSync } from "node:fs";

const BOOLEAN_DEFAULTS = new Set(["true", "false"]);

// Reduce HEY's catalog to what routing and help need. Every flag keeps its default,
// including zero/false/empty ones, so `--help` can state each flag's default.
// `types` maps "path --flag" to the value type HEY's --help prints (int, string, ...).
export function normalizeCatalog(nodes, types = {}) {
  return (nodes || []).map((node) => {
    const out = { name: node.name, path: node.path || node.name, short: node.short || "" };
    if (node.compatibility_usage) out.usage = node.compatibility_usage;
    if (node.agent_notes) out.notes = node.agent_notes;
    const flags = (node.flags || [])
      .filter((flag) => flag.name !== "help")
      .map((flag) => {
        const entry = { name: flag.name };
        if (flag.shorthand) entry.shorthand = flag.shorthand;
        const type = types[`${node.path || node.name} --${flag.name}`];
        if (type ? type !== "count" : !BOOLEAN_DEFAULTS.has(String(flag.default))) {
          entry.value = true;
          // Flags HEY hides from --help have no printed type; they take a string.
          entry.type = type || "string";
        }
        if (type === "count") entry.type = "count";
        if (flag.usage) entry.desc = flag.usage;
        if (flag.default !== undefined) entry.default = String(flag.default);
        return entry;
      });
    if (flags.length) out.flags = flags;
    if (node.subcommands?.length) out.subcommands = normalizeCatalog(node.subcommands, types);
    return out;
  });
}

// Which HEY the manifest covers, in words: "v1.7.0", or for a snapshot of an unreleased
// branch ("1.7.0+main.8bf9310") "v1.7.0 plus the commands on HEY main as of 2026-10-03
// (8bf9310, unreleased)".
export function coverageLabel(manifest) {
  const version = String(manifest.hey_version || "unknown");
  const match = version.match(/^(\d+\.\d+\.\d+)\+([\w.-]+)\.([0-9a-f]{7,})$/);
  if (!match) return /^\d/.test(version) ? `v${version}` : version;
  const date = manifest.hey_commit_date ? ` as of ${manifest.hey_commit_date}` : "";
  return `v${match[1]} plus the commands on HEY ${match[2]}${date} (commit ${match[3]}, unreleased)`;
}

export function loadBundledManifest() {
  return JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
}

// A group node can be invoked by itself when HEY documents a shortcut form for it
// (`box <name|id>`, `label <id>`, ...), when it takes flags of its own (`search`), or
// when its USAGE has a form without a subcommand (`hey set-aside [flags]`).
export function isRunnable(node) {
  return !node.subcommands?.length || Boolean(node.usage) || Boolean(node.flags?.length)
    || (node.synopsis || []).some((line) => !line.includes("<command>"));
}

// Resolve leading positional words to a command node.
// Returns { node, path, consumed } on success, or { error, ... } when the words
// don't name a runnable command.
export function resolveCommand(commands, words) {
  let level = commands;
  let node = null;
  let consumed = 0;
  for (const word of words) {
    const next = level?.find((candidate) => candidate.name === word);
    if (!next) break;
    node = next;
    consumed += 1;
    level = next.subcommands;
  }
  if (!node) return { error: "unknown command", word: words[0] };
  if (!isRunnable(node)) {
    const extra = words[consumed];
    return {
      error: extra === undefined ? "incomplete command" : "unknown subcommand",
      path: node.path,
      word: extra,
      subcommands: node.subcommands.map((child) => child.name),
    };
  }
  return { node, path: node.path, consumed };
}

// Collect every leaf (and runnable group) path, for help and coverage reporting.
export function listCommands(commands) {
  const paths = [];
  const walk = (nodes) => {
    for (const node of nodes || []) {
      if (isRunnable(node)) paths.push(node);
      walk(node.subcommands);
    }
  };
  walk(commands);
  return paths;
}

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

// Up to three command names close to a mistyped word, for "did you mean" help.
export function closestNames(word, nodes) {
  if (!word) return [];
  return (nodes || [])
    .map((node) => ({ name: node.name, score: node.name.startsWith(word) || word.startsWith(node.name) ? 0 : distance(word, node.name) }))
    .filter(({ score }) => score <= Math.max(2, Math.floor(word.length / 3)))
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map(({ name }) => name);
}
