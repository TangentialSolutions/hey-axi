#!/usr/bin/env node

import { spawn } from "node:child_process";
import { encode } from "@toon-format/toon";
import { loadBundledManifest, normalizeCatalog, resolveCommand } from "./router.js";
import { blockedReason } from "./policy.js";
import { RAW_OUTPUT_FLAGS, hasAny, scanArgs, valueFlagSet } from "./args.js";

// Resolve the HEY CLI: an explicit HEY_BIN wins, otherwise `hey` is looked up on PATH
// by spawn(), the same way a shell would find it.
const HEY = process.env.HEY_BIN || "hey";

function flagLabel(flag) {
  const short = flag.shorthand ? `, -${flag.shorthand}` : "";
  return `--${flag.name}${short}${flag.value ? " <value>" : ""}`;
}

function usage(manifest) {
  const lines = [
    "hey-axi — token-efficient HEY CLI interface",
    "",
    `commands (from hey ${manifest.hey_version}; run \`hey-axi <command> --help\` for details):`,
  ];
  for (const node of manifest.commands) {
    const subs = node.subcommands?.length ? ` ${node.subcommands.map((child) => child.name).join("|")}` : "";
    lines.push(`  ${node.name}${subs} — ${node.short}`);
  }
  lines.push(
    "",
    "output (HEY's global flags may go anywhere on the line):",
    "  default               HEY's JSON envelope (data, summary, notice, breadcrumbs, meta) rendered as TOON",
    "  --json                Print HEY's JSON envelope as compact JSON instead of TOON",
    "  --quiet               Drop the envelope: just the data (HEY then writes notices to stderr)",
    "  --ids-only, --count, --markdown, --html, --styled, --jq <expr>",
    "                        Passed to HEY untouched; HEY's output is printed as-is",
    "  --account <id|email>, --base-url <url>, --stats, -v   Forwarded to HEY",
    "  --help                Show this help (or `hey-axi <command> --help`)",
  );
  return lines.join("\n");
}

function commandHelp(node) {
  const lines = [`hey-axi ${node.path} — ${node.short}`];
  if (node.usage) lines.push(`shortcut: hey-axi ${node.usage}`);
  if (node.subcommands?.length) {
    lines.push("", "subcommands:");
    for (const child of node.subcommands) lines.push(`  ${child.path} — ${child.short}`);
  }
  if (node.flags?.length) {
    lines.push("", "flags:");
    for (const flag of node.flags) lines.push(`  ${flagLabel(flag)}`);
  }
  const reason = blockedReason(node.path);
  if (reason) lines.push("", `not supported by hey-axi: ${reason}`);
  return lines.join("\n");
}

function output(value) {
  process.stdout.write(`${encode(value)}\n`);
}

function spawnErrorMessage(error) {
  if (error.code === "ENOENT") {
    return process.env.HEY_BIN
      ? `HEY CLI not found at HEY_BIN=${process.env.HEY_BIN}`
      : "HEY CLI not found on PATH; install it (https://github.com/basecamp/hey-cli) or set HEY_BIN";
  }
  return error.message;
}

// Run HEY with captured output. `extra` holds the format flags hey-axi adds.
function runHey(args, extra = ["--json"]) {
  return new Promise((resolve) => {
    const child = spawn(HEY, [...args, ...extra], { stdio: ["inherit", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => resolve({ status: 127, error: spawnErrorMessage(error) }));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

// Run HEY exactly as typed, with stdout/stderr going straight to the terminal.
function runHeyRaw(args) {
  return new Promise((resolve) => {
    const child = spawn(HEY, args, { stdio: "inherit" });
    child.on("error", (error) => resolve({ status: 127, error: spawnErrorMessage(error) }));
    child.on("close", (status, signal) => resolve({ status: status ?? (signal ? 1 : 0) }));
  });
}

// Ask the installed HEY for its live catalog, for commands newer than the bundled manifest.
async function discoverCommands() {
  const result = await runHey(["commands"]);
  if (result.status !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout);
    const data = Array.isArray(parsed) ? parsed : parsed?.data;
    return Array.isArray(data) ? normalizeCatalog(data) : null;
  } catch {
    return null;
  }
}

const manifest = loadBundledManifest();
const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  process.stdout.write(`${usage(manifest)}\n`);
  process.exit(0);
}

const { words, flags } = scanArgs(args, valueFlagSet(manifest.commands));
const json = flags.has("--json");
const quiet = flags.has("--quiet");
const raw = hasAny(flags, RAW_OUTPUT_FLAGS);
const command = args.filter((arg) => arg !== "--json" && arg !== "--quiet");

let resolved = resolveCommand(manifest.commands, words);
if (resolved.error === "unknown command" || resolved.error === "unknown subcommand") {
  const live = await discoverCommands();
  const retry = live && resolveCommand(live, words);
  if (retry && !retry.error) resolved = retry;
}

if (resolved.error) {
  const failure = { ok: false, error: resolved.error };
  if (resolved.path) failure.command = resolved.path;
  if (resolved.word) failure.word = resolved.word;
  if (resolved.subcommands) failure.subcommands = resolved.subcommands;
  failure.usage = "Run hey-axi --help";
  output(failure);
  process.exit(2);
}

if (flags.has("--help") || flags.has("-h")) {
  process.stdout.write(`${commandHelp(resolved.node)}\n`);
  process.exit(0);
}

const blocked = blockedReason(resolved.path);
if (blocked) {
  output({ ok: false, error: "unsupported command", command: resolved.path, reason: blocked });
  process.exit(2);
}

if (raw) {
  // --ids-only, --count, --markdown, --html, --styled, --jq: HEY owns the output format.
  const result = await runHeyRaw(args);
  if (result.error) {
    output({ ok: false, error: result.error, exit_code: result.status });
    process.exit(1);
  }
  process.exit(result.status);
}

const result = await runHey(command, quiet ? ["--json", "--quiet"] : ["--json"]);
if (result.status === 0 && result.stderr) process.stderr.write(result.stderr);

if (result.status !== 0) {
  output({ ok: false, error: result.error || result.stdout.trim() || result.stderr.trim() || "hey command failed", exit_code: result.status });
  process.exit(1);
}

try {
  const parsed = JSON.parse(result.stdout);
  if (json) process.stdout.write(`${JSON.stringify(parsed)}\n`);
  else output(parsed);
} catch (error) {
  output({ ok: false, error: "HEY returned invalid JSON", detail: error.message });
  process.exit(1);
}
