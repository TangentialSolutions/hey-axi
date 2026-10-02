// Data-driven command routing for hey-axi.
//
// The command tree comes from HEY's own `hey commands --json` catalog: a bundled
// snapshot (src/manifest.json, refreshed with `npm run refresh-manifest`), plus
// discovery from the installed binary at runtime when the snapshot doesn't know a
// command.

import { readFileSync } from "node:fs";

const BOOLEAN_DEFAULTS = new Set(["true", "false"]);

// Reduce HEY's catalog to what routing and help need.
export function normalizeCatalog(nodes) {
  return (nodes || []).map((node) => {
    const out = { name: node.name, path: node.path || node.name, short: node.short || "" };
    if (node.compatibility_usage) out.usage = node.compatibility_usage;
    const flags = (node.flags || [])
      .filter((flag) => flag.name !== "help")
      .map((flag) => {
        const entry = { name: flag.name };
        if (flag.shorthand) entry.shorthand = flag.shorthand;
        if (!BOOLEAN_DEFAULTS.has(String(flag.default))) entry.value = true;
        return entry;
      });
    if (flags.length) out.flags = flags;
    if (node.subcommands?.length) out.subcommands = normalizeCatalog(node.subcommands);
    return out;
  });
}

export function loadBundledManifest() {
  return JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
}

// A group node can be invoked by itself when HEY documents a shortcut form for it
// (`box <name|id>`, `label <id>`, ...) or when it takes flags of its own (`search`).
export function isRunnable(node) {
  return !node.subcommands?.length || Boolean(node.usage) || Boolean(node.flags?.length);
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
