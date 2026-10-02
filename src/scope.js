// Directory scope for the home view and the session hook (AXI principle 7: show only
// state relevant to the current directory). A `.hey-axi.json` in the working directory
// or any parent focuses that tree on one box, label or search, and optionally one
// linked account:
//
//   { "label": "Acme", "account": "12345", "limit": 10 }
//
// `hey-axi setup scope --label Acme` writes it; with no file the home view is the
// account-wide Imbox and says so.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HOME_LIMIT } from "./guide.js";
import { collapse } from "./home-path.js";

export const SCOPE_FILE = ".hey-axi.json";
const SOURCES = ["box", "label", "search"];
const KEYS = new Set([...SOURCES, "account", "limit"]);

export class ScopeError extends Error {}

function validate(config, path) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new ScopeError(`${collapse(path)} must hold a JSON object`);
  const unknown = Object.keys(config).filter((key) => !KEYS.has(key));
  if (unknown.length) throw new ScopeError(`${collapse(path)}: unknown key ${unknown.join(", ")} (allowed: ${[...KEYS].join(", ")})`);
  const sources = SOURCES.filter((key) => config[key] !== undefined);
  if (sources.length > 1) throw new ScopeError(`${collapse(path)}: use only one of ${SOURCES.join(", ")}`);
  for (const key of [...SOURCES, "account"]) {
    if (config[key] !== undefined && (typeof config[key] !== "string" || !config[key].trim())) throw new ScopeError(`${collapse(path)}: ${key} must be a non-empty string`);
  }
  if (config.limit !== undefined && !(Number.isInteger(config.limit) && config.limit > 0 && config.limit <= 100)) {
    throw new ScopeError(`${collapse(path)}: limit must be a whole number from 1 to 100`);
  }
  return config;
}

// The nearest .hey-axi.json at or above `cwd`: { path, dir, config }, or null.
export function findScope(cwd = process.cwd()) {
  let dir = resolve(cwd);
  for (;;) {
    const path = join(dir, SCOPE_FILE);
    if (existsSync(path)) {
      let config;
      try {
        config = JSON.parse(readFileSync(path, "utf8"));
      } catch (error) {
        throw new ScopeError(`${collapse(path)} is not valid JSON: ${error.message}`);
      }
      return { path, dir, config: validate(config, path) };
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// What the home view runs for a scope, and how to describe it.
//   argv:     HEY arguments
//   base:     the equivalent hey-axi command line (for help lines)
//   carry:    selector args to carry into suggested commands
//   label:    one line for the `scope:` field
export function scopeQuery(scope) {
  const config = scope?.config || {};
  const limit = config.limit || HOME_LIMIT;
  const carry = config.account ? ["--account", config.account] : [];
  let argv;
  let what;
  if (config.search) {
    argv = ["search", config.search];
    what = `search ${config.search}`;
  } else if (config.label) {
    argv = ["label", "view", config.label, "--limit", String(limit)];
    what = `label ${config.label}`;
  } else {
    const box = config.box || "imbox";
    argv = ["box", "view", box, "--limit", String(limit)];
    what = box === "imbox" ? "Imbox" : `box ${box}`;
  }
  const words = argv.filter((word, index) => !(word === "--limit" || argv[index - 1] === "--limit"));
  const shell = (word) => (/^[\w@%+=:,./-]+$/.test(word) ? word : `"${word.replace(/"/g, '\\"')}"`);
  const base = ["hey-axi", ...words.map(shell), ...carry].join(" ");
  const account = config.account ? `, account ${config.account}` : "";
  const label = scope
    ? `${what}${account} (from ${collapse(scope.path)})`
    : `account-wide ${what} (no ${SCOPE_FILE} here; \`hey-axi setup scope --label <name>\` focuses this directory)`;
  return { argv: [...argv, ...carry], base, carry, label, limit, path: argv[0] === "search" ? "search" : `${argv[0]} view` };
}

export const SCOPE_HELP = [
  "hey-axi setup scope — focus the home view and session hook in this directory on one box, label or search",
  "",
  "usage: hey-axi setup scope (--box <name|id> | --label <name|id> | --search <query>) [--account <id>] [--limit <n>]",
  "       hey-axi setup scope --status | --remove",
  "",
  "flags:",
  "  --box <name|id>     show this box (default imbox)",
  "  --label <name|id>   show threads with this label",
  "  --search <query>    show threads matching this search",
  "  --account <id>      use this linked account (default: HEY's default account)",
  "  --limit <n>         threads to show, 1-100 (default 10)",
  "  --status            show the scope that applies here; writes nothing",
  "  --remove            delete ./.hey-axi.json",
  "",
  `Writes ./${SCOPE_FILE}; subdirectories inherit it. Re-running with the same settings changes nothing.`,
  "",
  "examples:",
  "  hey-axi setup scope --label Acme",
  "  hey-axi setup scope --search \"from:billing@acme.example\" --limit 5",
  "  hey-axi setup scope --status",
].join("\n");

export const SCOPE_FLAGS = new Set(["--box", "--label", "--search", "--account", "--limit", "--status", "--remove", "--help", "-h"]);
const SCOPE_VALUE_FLAGS = new Set(["--box", "--label", "--search", "--account", "--limit"]);

// `hey-axi setup scope ...`. Returns { output, code }.
export function setupScope(argv, cwd = process.cwd()) {
  const values = {};
  const flags = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.indexOf("=");
    const name = arg.startsWith("--") && eq !== -1 ? arg.slice(0, eq) : arg;
    if (!SCOPE_FLAGS.has(name)) {
      return { code: 2, output: { ok: false, error: arg.startsWith("-") ? `unknown flag ${name} for \`setup scope\`` : `unexpected argument "${arg}" for \`setup scope\``, help: ["valid flags for `setup scope`: --box, --label, --search, --account, --limit, --status, --remove", "Run `hey-axi setup scope --help`"] } };
    }
    if (eq !== -1 && !SCOPE_VALUE_FLAGS.has(name)) {
      return { code: 2, output: { ok: false, kind: "usage", error: `${name} is a switch and takes no value: pass ${name}, or leave it out (got ${arg})`, help: "Run `hey-axi setup scope --help`" } };
    }
    flags.add(name);
    if (SCOPE_VALUE_FLAGS.has(name)) {
      const value = eq !== -1 ? arg.slice(eq + 1) : argv[i + 1];
      if (value === undefined || (eq === -1 && value.startsWith("--"))) return { code: 2, output: { ok: false, error: `missing value for ${name}`, help: "Run `hey-axi setup scope --help`" } };
      values[name.slice(2)] = value;
      if (eq === -1) i += 1;
    }
  }
  const path = join(resolve(cwd), SCOPE_FILE);
  if (flags.has("--status") || flags.has("--remove")) {
    if (Object.keys(values).length || (flags.has("--status") && flags.has("--remove"))) {
      return { code: 2, output: { ok: false, error: "--status and --remove take no other flags", help: "Run `hey-axi setup scope --status` or `hey-axi setup scope --remove`" } };
    }
  }
  if (flags.has("--status")) {
    try {
      const scope = findScope(cwd);
      return { code: 0, output: { scope: scopeQuery(scope).label } };
    } catch (error) {
      return { code: 1, output: { ok: false, error: error.message, help: `Fix or delete the file, then run \`hey-axi setup scope --status\`` } };
    }
  }
  if (flags.has("--remove")) {
    if (!existsSync(path)) return { code: 0, output: { scope: `nothing to remove: no ${SCOPE_FILE} in this directory (no-op)` } };
    rmSync(path);
    return { code: 0, output: { scope: `removed ${collapse(path)}`, help: ["Run `hey-axi` to see the home view for this directory"] } };
  }
  const config = {};
  for (const key of ["box", "label", "search", "account"]) if (values[key] !== undefined) config[key] = values[key];
  if (values.limit !== undefined) {
    if (!/^\d+$/.test(values.limit)) return { code: 2, output: { ok: false, error: `--limit needs a whole number, got "${values.limit}"` } };
    config.limit = Number(values.limit);
  }
  if (!SOURCES.some((key) => config[key] !== undefined)) {
    return { code: 2, output: { ok: false, error: "`setup scope` needs one of --box, --label, --search", help: ["usage: hey-axi setup scope (--box <name|id> | --label <name|id> | --search <query>) [--account <id>] [--limit <n>]"] } };
  }
  try {
    validate(config, path);
  } catch (error) {
    return { code: 2, output: { ok: false, error: error.message.replace(`${collapse(path)}: `, ""), help: "Run `hey-axi setup scope --help`" } };
  }
  const next = `${JSON.stringify(config, null, 2)}\n`;
  const current = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (current === next) return { code: 0, output: { scope: `already up to date (no changes): ${scopeQuery({ path, config }).label}` } };
  writeFileSync(path, next);
  return { code: 0, output: { scope: `${current === null ? "wrote" : "updated"} ${scopeQuery({ path, config }).label}`, help: ["Run `hey-axi` to see the scoped home view", "Run `hey-axi setup scope --remove` to undo"] } };
}
