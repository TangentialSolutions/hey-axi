#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { encode } from "@toon-format/toon";
import { loadBundledManifest, normalizeCatalog, resolveCommand } from "./router.js";
import { AXI_FLAGS, checkPolicy, runMode, sendStaging } from "./policy.js";
import { heyFailure } from "./errors.js";
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
    "",
    "safety:",
    "  Nothing is sent without --allow-send (or HEY_AXI_ALLOW_SEND=1): compose and reply are saved",
    "  as drafts (hey-axi adds --draft and says so); forward, draft send and bulk-reply send are refused.",
    "  auth token needs --allow-secret / HEY_AXI_ALLOW_SECRETS=1.",
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
  const mode = runMode(node.path, new Set());
  if (mode === "interactive") lines.push("", "runs interactively: HEY gets the terminal; output is not converted");
  if (mode === "stream") lines.push("", "streams HEY's NDJSON line by line until it exits or is interrupted");
  if (mode === "raw") lines.push("", "prints HEY's output as-is (not JSON)");
  const gate = checkPolicy(node.path, new Set(), {}, { stdin: true, stdout: true });
  if (gate) lines.push("", `${gate.error}: ${gate.reason}; ${gate.hint}`);
  if (sendStaging(node.path, new Set(), {})) lines.push("", "without --allow-send (or HEY_AXI_ALLOW_SEND=1) hey-axi adds --draft: it's saved as a draft, not sent");
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

// Relay SIGINT/SIGTERM to HEY and let it decide how to exit, instead of dying first.
function forwardSignals(child) {
  const handlers = ["SIGINT", "SIGTERM", "SIGHUP"].map((signal) => {
    const handler = () => child.kill(signal);
    process.on(signal, handler);
    return [signal, handler];
  });
  return () => handlers.forEach(([signal, handler]) => process.off(signal, handler));
}

const exitStatus = (status, signal) => status ?? (signal ? 128 + (({ SIGHUP: 1, SIGINT: 2, SIGTERM: 15 })[signal] || 0) : 0);

// Run HEY exactly as typed, with stdio going straight to the terminal (raw output and
// interactive commands).
function runHeyRaw(args) {
  return new Promise((resolve) => {
    const child = spawn(HEY, args, { stdio: "inherit" });
    const release = forwardSignals(child);
    child.on("error", (error) => { release(); resolve({ status: 127, error: spawnErrorMessage(error) }); });
    child.on("close", (status, signal) => { release(); resolve({ status: exitStatus(status, signal) }); });
  });
}

// Run a long-lived NDJSON producer (hey watch), relaying each complete line the moment
// it arrives so consumers never see a partial event.
function runHeyStream(args) {
  return new Promise((resolve) => {
    const child = spawn(HEY, args, { stdio: ["inherit", "pipe", "inherit"] });
    const release = forwardSignals(child);
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => process.stdout.write(`${line}\n`));
    // A consumer that stops reading (e.g. `| head -1`) ends the watch cleanly.
    process.stdout.on("error", (error) => {
      if (error.code === "EPIPE") child.kill("SIGTERM");
    });
    child.on("error", (error) => { release(); resolve({ status: 127, error: spawnErrorMessage(error) }); });
    child.on("close", (status, signal) => { release(); lines.close(); resolve({ status: exitStatus(status, signal) }); });
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
const heyArgs = args.filter((arg) => !AXI_FLAGS.includes(arg));
const json = flags.has("--json");
const quiet = flags.has("--quiet");
const raw = hasAny(flags, RAW_OUTPUT_FLAGS);
const command = heyArgs.filter((arg) => arg !== "--json" && arg !== "--quiet");

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

const refusal = checkPolicy(resolved.path, flags);
if (refusal) {
  output({ ok: false, ...refusal });
  process.exit(2);
}

// compose/reply without a send opt-in: save a draft instead of sending.
const staging = sendStaging(resolved.path, flags);
if (staging) {
  heyArgs.push(staging.flag);
  command.push(staging.flag);
  process.stderr.write(`hey-axi: ${staging.notice}\n`);
}

// Put hey-axi's "saved as a draft, not sent" marker at the top of the result.
function markStaged(parsed) {
  if (!staging) return parsed;
  const marker = { sent: false, saved_as: "draft", axi_notice: staging.notice };
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const { ok, ...rest } = parsed;
    return ok === undefined ? { ...marker, ...rest } : { ok, ...marker, ...rest };
  }
  return { ...marker, data: parsed };
}

const mode = runMode(resolved.path, flags);
if (raw || mode !== "json") {
  // interactive: tui, login, setup, mcp, upgrade; stream: watch; raw: scripts, CSV, and
  // --ids-only/--count/--markdown/--html/--styled/--jq. HEY owns the output.
  const result = mode === "stream" ? await runHeyStream(heyArgs) : await runHeyRaw(heyArgs);
  if (result.error) output(heyFailure(result));
  process.exit(result.status);
}

const result = await runHey(command, quiet ? ["--json", "--quiet"] : ["--json"]);
if (result.status === 0 && result.stderr) process.stderr.write(result.stderr);

if (result.status !== 0) {
  // Pass HEY's exit code through: 1 usage, 2 not found, 3 auth, 4 forbidden,
  // 5 rate limit, 6 network, 7 API, 8 ambiguous (see `hey help exit-codes`).
  output(heyFailure(result));
  process.exit(result.status);
}

try {
  const parsed = markStaged(JSON.parse(result.stdout));
  if (json) process.stdout.write(`${JSON.stringify(parsed)}\n`);
  else output(parsed);
} catch (error) {
  output({ ok: false, error: "HEY returned invalid JSON", detail: error.message });
  process.exit(1);
}
