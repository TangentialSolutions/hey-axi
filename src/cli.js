// hey-axi's CLI. Loaded by src/hey-axi.js only after the --version fast path.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { encode } from "@toon-format/toon";
import { loadBundledManifest, normalizeCatalog, resolveCommand } from "./router.js";
import { checkPolicy, runMode, sendStaging } from "./policy.js";
import { heyFailure } from "./errors.js";
import { RAW_OUTPUT_FLAGS, flagLabel, flagValue, hasAny, scanArgs, stripAxiFlags, validateFlags, valueFlagSet } from "./args.js";
import { FieldError, LIST_FIELDS, DETAIL_FIELDS, shapeData, shapeEnvelope } from "./shape.js";
import { homeView } from "./home.js";
import { DESCRIPTION } from "./guide.js";
import { heyToAxi, shellWord } from "./text.js";
import { VERSION } from "./version.js";

// Resolve the HEY CLI: an explicit HEY_BIN wins, otherwise `hey` is looked up on PATH
// by spawn(), the same way a shell would find it.
const HEY = process.env.HEY_BIN || "hey";

function usage(manifest) {
  const lines = [
    `hey-axi ${VERSION} — ${DESCRIPTION}`,
    "",
    "Run `hey-axi` with no arguments for a live home view (Imbox summary + next commands).",
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
    "  --fields a,b,c        Choose list columns (aliases from the defaults or dotted paths); --fields all keeps every field",
    "  --full                HEY's complete, untruncated result (no field selection, no truncation)",
    "  --account <id|email>, --base-url <url>, --stats, --verbose   Forwarded to HEY",
    "  --help                Show this help (or `hey-axi <command> --help`)",
    "  -v, -V, --version     Print hey-axi's version (`hey-axi version` also shows HEY's)",
    "",
    "lists default to a few columns and cut long text (with its total size); unknown flags are rejected (exit 2).",
    "",
    "session hook: `hey-axi setup hooks` shows the home view at the start of Claude Code, Codex and OpenCode sessions.",
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
  for (const synopsis of node.synopsis || []) lines.push(`usage: ${heyToAxi(synopsis)}`);
  if (node.usage) lines.push(`shortcut: hey-axi ${node.usage}`);
  if (node.subcommands?.length) {
    lines.push("", "subcommands:");
    for (const child of node.subcommands) lines.push(`  ${child.path} — ${child.short}`);
  }
  if (node.flags?.length) {
    lines.push("", "flags:");
    for (const flag of node.flags) {
      const extra = [flag.desc, flag.default !== undefined ? `(default ${flag.default})` : ""].filter(Boolean).join(" ");
      lines.push(`  ${flagLabel(flag)}${extra ? `  ${extra}` : ""}`);
    }
  }
  const fields = LIST_FIELDS[node.path] || DETAIL_FIELDS[node.path];
  if (fields) {
    lines.push("", `default fields: ${fields.map((spec) => spec.split("=")[0]).join(", ")}  (--fields a,b,c to choose, --fields all for every field, --full for HEY's untouched result)`);
  }
  if (node.examples?.length) {
    lines.push("", "examples:");
    for (const example of node.examples) lines.push(`  ${heyToAxi(example)}`);
  }
  if (node.notes) lines.push("", `notes: ${heyToAxi(node.notes)}`);
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

export async function main(args = process.argv.slice(2)) {
const manifest = loadBundledManifest();
if (args.length === 0) {
  output(await homeView(runHey));
  process.exit(0);
}
if (args[0] === "--help" || args[0] === "-h") {
  process.stdout.write(`${usage(manifest)}\n`);
  process.exit(0);
}

const { words, flags } = scanArgs(args, valueFlagSet(manifest.commands));

// hey-axi's own setup command; every other `setup …` is HEY's (interactive).
if (words[0] === "setup" && words[1] === "hooks" && words.length === 2) {
  const { HOOKS_HELP, setupHooks } = await import("./hooks.js");
  if (flags.has("--help") || flags.has("-h")) {
    process.stdout.write(`${HOOKS_HELP}\n`);
    process.exit(0);
  }
  const { output: result, code } = await setupHooks(flags);
  output(result);
  process.exit(code);
}

const heyArgs = stripAxiFlags(args);
const json = flags.has("--json");
const quiet = flags.has("--quiet");
const full = flags.has("--full");
const raw = hasAny(flags, RAW_OUTPUT_FLAGS);
const command = heyArgs.filter((arg) => arg !== "--json" && arg !== "--quiet");
const fieldsArg = flagValue(args, "fields");
const fields = fieldsArg === undefined ? null : fieldsArg.trim() === "all" ? "all" : fieldsArg.split(",").map((name) => name.trim()).filter(Boolean);
// The command as the agent typed it, minus output/shaping flags, for `--full` hints.
const commandLine = ["hey-axi", ...stripAxiFlags(args).filter((arg) => arg !== "--json" && arg !== "--quiet")].map(shellWord).join(" ");

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
  failure.help = resolved.path ? `Run \`hey-axi ${resolved.path} --help\`` : "Run `hey-axi --help` for all commands";
  output(failure);
  process.exit(2);
}

const invalid = validateFlags(resolved.node, flags);
if (invalid) {
  const valid = (resolved.node.flags || []).map(flagLabel);
  const failure = { ok: false, command: resolved.path };
  if (invalid.unknown) {
    failure.error = `unknown flag ${invalid.unknown.join(", ")} for \`${resolved.path}\``;
  } else {
    failure.error = `missing required flag ${invalid.missing.join(", ")} for \`${resolved.path}\``;
  }
  failure.help = [
    valid.length ? `valid flags for \`${resolved.path}\`: ${valid.join(", ")}` : `\`${resolved.path}\` takes no flags of its own`,
    "always allowed: --help, --json, --quiet, --fields, --full, --account, --ids-only, --count, --markdown, --html, --styled, --jq, --stats, --verbose, --base-url, --allow-send, --allow-secret",
    ...(resolved.node.synopsis || []).map((line) => `usage: ${heyToAxi(line)}`),
  ];
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

// `hey-axi version`: hey-axi's own version next to HEY's.
if (resolved.path === "version") {
  const result = await runHey(command, ["--json"]);
  const versions = { hey_axi: VERSION };
  if (result.status === 0) {
    try {
      const parsed = JSON.parse(result.stdout);
      const data = parsed && typeof parsed === "object" && "data" in parsed ? parsed.data : parsed;
      versions.hey = data?.version ?? data;
      if (data?.commit) versions.hey_commit = data.commit;
    } catch {
      versions.hey = result.stdout.trim();
    }
  } else {
    // hey-axi still knows its own version; the failure says what's wrong with HEY.
    const failure = { ok: false, hey_axi: VERSION, ...heyFailure(result) };
    delete failure.ok;
    output({ ok: false, ...failure });
    process.exit(result.status);
  }
  if (json) process.stdout.write(`${JSON.stringify(versions)}\n`);
  else output(versions);
  process.exit(0);
}

const result = await runHey(command, quiet ? ["--json", "--quiet"] : ["--json"]);
if (result.status === 0 && result.stderr) process.stderr.write(result.stderr);

if (result.status !== 0) {
  // Pass HEY's exit code through: 1 usage, 2 not found, 3 auth, 4 forbidden,
  // 5 rate limit, 6 network, 7 API, 8 ambiguous (see `hey help exit-codes`).
  output(heyFailure(result));
  process.exit(result.status);
}

let parsed;
try {
  parsed = JSON.parse(result.stdout);
} catch (error) {
  output({ ok: false, error: "HEY returned invalid JSON", detail: error.message });
  process.exit(1);
}

let shaped;
try {
  if (full) shaped = parsed;
  else if (quiet) {
    const { data, truncated } = shapeData(parsed, { path: resolved.path, fields });
    shaped = data;
    if (truncated) process.stderr.write(`hey-axi: long text was truncated; run \`${commandLine} --full\` to see all of it\n`);
  } else shaped = shapeEnvelope(parsed, { path: resolved.path, fields, commandLine });
} catch (error) {
  if (!(error instanceof FieldError)) throw error;
  output({
    ok: false,
    error: `unknown field ${error.unknown.join(", ")} for \`${resolved.path}\``,
    help: [`available fields: ${error.available.join(", ")}`, "dotted paths (creator.email_address) and --fields all also work"],
  });
  process.exit(2);
}
shaped = markStaged(shaped);
if (json) process.stdout.write(`${JSON.stringify(shaped)}\n`);
else output(shaped);
}
