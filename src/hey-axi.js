#!/usr/bin/env node

import { spawn } from "node:child_process";
import { encode } from "@toon-format/toon";
import { loadBundledManifest, normalizeCatalog, resolveCommand } from "./router.js";
import { blockedReason } from "./policy.js";

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
    "flags:",
    "  --json                Print HEY's JSON instead of TOON",
    "  --help                Show this help",
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

function runHey(args) {
  return new Promise((resolve) => {
    const child = spawn(HEY, [...args, "--json", "--quiet"], { stdio: ["inherit", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => resolve({ status: 127, error: spawnErrorMessage(error) }));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
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

const json = args.includes("--json");
const command = args.filter((arg) => arg !== "--json");
const words = [];
for (const arg of command) {
  if (arg.startsWith("-")) break;
  words.push(arg);
}

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

if (command.includes("--help") || command.includes("-h")) {
  process.stdout.write(`${commandHelp(resolved.node)}\n`);
  process.exit(0);
}

const blocked = blockedReason(resolved.path);
if (blocked) {
  output({ ok: false, error: "unsupported command", command: resolved.path, reason: blocked });
  process.exit(2);
}

const result = await runHey(command);

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
