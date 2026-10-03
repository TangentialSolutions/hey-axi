// hey-axi's CLI. Loaded by src/hey-axi.js only after the --version fast path.
//
// Order of checks, all before HEY runs: the command must exist, its flags must be known,
// have their values and the right types, its positional arguments must fit HEY's USAGE,
// the safety policy must allow it, and content that would otherwise open an editor must
// be given. Only then is HEY started, non-interactively.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { encode } from "@toon-format/toon";
import { closestNames, loadBundledManifest, resolveCommand } from "./router.js";
import { STDIN_VALUE_FLAGS, checkPolicy, contentProblem, noopFor, runMode, sendCommands, sendStaging, userOnlyPaths } from "./policy.js";
import { translateFailure, cleanLine, warningLines } from "./errors.js";
import { RAW_OUTPUT_FLAGS, flagLabel, flagValue, hasAny, nodeValueFlags, scanArgs, stripAxiFlags, validateFlags, valueFlagSet } from "./args.js";
import { argumentHelp, checkArity, oneOfHelp } from "./arity.js";
import { FieldError, LIST_FIELDS, DETAIL_FIELDS, carrySelectors, withSelectors, shapeEnvelope } from "./shape.js";
import { homeView } from "./home.js";
import { DESCRIPTION } from "./guide.js";
import { heyToAxi, shellWord } from "./text.js";
import { examplesFor, flagDefault } from "./examples.js";
import { VERSION } from "./version.js";

// Resolve the HEY CLI: an explicit HEY_BIN wins, otherwise `hey` is looked up on PATH
// by spawn(), the same way a shell would find it.
const HEY = process.env.HEY_BIN || "hey";

// HEY never prompts or opens an editor under hey-axi: stdin is closed and these are set.
const QUIET_ENV = { HEY_NONINTERACTIVE: "1", EDITOR: "false", VISUAL: "false" };
const heyEnv = () => ({ ...process.env, ...QUIET_ENV });

const ALWAYS_ALLOWED = "--help, --json, --quiet, --fields, --full, --account, --ids-only, --count, --markdown, --html, --styled, --jq, --stats, --verbose, --base-url, --allow-send, --allow-secret, --interactive";

const GLOBAL_HELP = [
  "--account <id|all>  linked account (default: HEY's default account)",
  "--base-url <url>  HEY server (default: HEY's configured server)",
  "--json  the same shaped result as compact JSON (default false: TOON)",
  "--quiet  drop HEY's summary/notice/breadcrumbs/meta, keep data, count and hints (default false)",
  "--fields <a,b|all>  columns to show (default: the default fields)",
  "--full  HEY's complete, untruncated result (default false)",
  "--ids-only, --count, --markdown, --html, --styled, --jq <expr>  HEY's own output format, printed as-is (default: none)",
  "--stats, --verbose  request stats / debug logging on stderr (default false)",
];
const OWN_FLAG_HELP = [
  [(path) => sendCommands().includes(path), "--allow-send  really send (default false: saved as a draft, or refused when there is no draft mode)"],
  [(path) => path === "auth token", "--allow-secret  print the token (default false: refused)"],
  [(path) => userOnlyPaths().includes(path), "--interactive  hand HEY the terminal; for a person at a terminal (default false: refused)"],
];

function usage(manifest) {
  const lines = [
    `hey-axi ${VERSION} — ${DESCRIPTION}`,
    "",
    "Run `hey-axi` with no arguments for a live home view (mail for this directory's scope + next commands).",
    "",
    `commands (from hey ${manifest.hey_version}; run \`hey-axi <command> --help\` for details):`,
  ];
  for (const node of manifest.commands) {
    const subs = node.subcommands?.length ? ` ${node.subcommands.map((child) => child.name).join("|")}` : "";
    lines.push(`  ${node.name}${subs} — ${node.short}`);
  }
  lines.push(
    "  setup hooks — session start/end hooks for Claude Code, Codex and OpenCode (hey-axi's own)",
    "  setup scope — focus the home view in this directory on a box, label or search (hey-axi's own)",
    "",
    "output (global flags may go anywhere on the line):",
    "  default               HEY's JSON envelope (data, summary, notice, breadcrumbs, meta) rendered as TOON",
    "  --json                The same shaped result as compact JSON instead of TOON",
    "  --quiet               Drop HEY's summary/notice/breadcrumbs/meta; keep data, count, empty state and hints",
    "  --ids-only, --count, --markdown, --html, --styled, --jq <expr>",
    "                        Passed to HEY untouched; HEY's output is printed as-is",
    "  --fields a,b,c        Choose list columns (aliases from the defaults or dotted paths); --fields all keeps every field",
    "  --full                HEY's complete, untruncated result (no field selection, no truncation)",
    "  --account <id|all>    Linked account (default: HEY's default account); also --base-url <url>, --stats, --verbose",
    "  --interactive         Hand HEY the terminal for tui, setup, browser auth login and mcp (refused without it)",
    "  --help                Show this help (or `hey-axi <command> --help`)",
    "  -v, -V, --version     Print hey-axi's version (`hey-axi version` also shows HEY's)",
    "",
    "lists show at most 4 columns, a count, and cut long text (with its total size).",
    "unknown commands, flags or arguments, flags missing a value, and wrong value types are rejected before HEY runs (exit 2).",
    "exit codes: 0 success (including no-ops), 1 error, 2 usage error or refusal. Errors are TOON on stdout with `kind` and `help`.",
    "HEY never prompts: content that would open an editor must be passed (--message, or --message - for stdin).",
    "",
    "safety:",
    "  Nothing is sent without --allow-send (or HEY_AXI_ALLOW_SEND=1): compose and reply are saved",
    "  as drafts (hey-axi adds --draft and says so); forward, draft send and bulk-reply send are refused.",
    "  auth token needs --allow-secret / HEY_AXI_ALLOW_SECRETS=1.",
  );
  return lines.join("\n");
}

export function commandHelp(node) {
  const lines = [`hey-axi ${node.path} — ${node.short}`];
  for (const synopsis of node.synopsis || []) if (!synopsis.includes("<command>") || !node.usage) lines.push(`usage: ${heyToAxi(synopsis)}`);
  if (node.usage) lines.push(`shortcut: hey-axi ${node.usage}`);
  const args = [...argumentHelp(node), ...oneOfHelp(node)];
  if (args.length) {
    lines.push("", "arguments:");
    for (const arg of args) lines.push(`  ${arg}`);
  }
  if (node.subcommands?.length) {
    lines.push("", "subcommands:");
    for (const child of node.subcommands) lines.push(`  ${child.path} — ${child.short}`);
  }
  if (node.flags?.length) {
    lines.push("", "flags:");
    for (const flag of node.flags) {
      const extra = [flag.desc, `(${flagDefault(flag)})`].filter(Boolean).join(" ");
      lines.push(`  ${flagLabel(flag)}  ${extra}`);
    }
  }
  lines.push("", "global flags (allowed on every command):", ...GLOBAL_HELP.map((line) => `  ${line}`));
  const own = OWN_FLAG_HELP.filter(([applies]) => applies(node.path)).map(([, line]) => `  ${line}`);
  if (own.length) lines.push(...own);
  const fields = LIST_FIELDS[node.path] || DETAIL_FIELDS[node.path];
  if (fields) {
    lines.push("", `default fields: ${fields.map((spec) => spec.split("=")[0]).join(", ")}  (--fields a,b,c to choose, --fields all for every field, --full for HEY's untouched result)`);
  }
  lines.push("", "examples:");
  for (const example of examplesFor(node)) lines.push(`  ${example}`);
  if (node.notes) lines.push("", `notes: ${heyToAxi(node.notes)}`);
  const mode = runMode(node.path, new Set(["--interactive"]));
  if (mode === "interactive") lines.push("", "needs a person (or, for mcp, an MCP client): refused (exit 2) unless --interactive is passed; then HEY gets the terminal");
  if (mode === "stream") lines.push("", "streams each event as it arrives (a TOON block per event; --json for HEY's NDJSON) until it exits or is interrupted");
  if (mode === "raw") lines.push("", "prints HEY's output as-is (not JSON)");
  const gate = checkPolicy(node.path, new Set(), {}, { stdin: true, stdout: true });
  if (gate) lines.push("", `${gate.error}: ${gate.reason}; ${gate.hint}`);
  const content = contentProblem(node, new Set(), []);
  if (content) lines.push("", `required: ${content.error.replace("missing ", "")} (${content.hint}); HEY never opens an editor under hey-axi`);
  if (sendStaging(node.path, new Set(), {})) lines.push("", "without --allow-send (or HEY_AXI_ALLOW_SEND=1) hey-axi adds --draft: it's saved as a draft, not sent");
  return lines.join("\n");
}

function output(value) {
  process.stdout.write(`${encode(value)}\n`);
}

// Only HEY's real warnings reach stderr; debug and progress noise is dropped.
function writeWarnings(text) {
  for (const line of warningLines(text)) process.stderr.write(`${line}\n`);
}

const HOOK_END_HELP = [
  "hey-axi hook session-end — record what this agent session did (run by the session-end hooks)",
  "usage: hey-axi hook session-end   (reads the hook's JSON payload from stdin: session_id, cwd)",
  "",
  "Folds this session's hey-axi activity in the current directory scope (command names and numeric",
  "ids only) into a one-line summary that the next home view shows as last_session. Does nothing",
  "unless `hey-axi setup hooks` turned capture on. Takes no flags; always exits 0.",
  "",
  "examples:",
  "  echo '{\"session_id\":\"abc\",\"cwd\":\"/path/to/project\"}' | hey-axi hook session-end",
  "  hey-axi setup hooks          # installs this hook for Claude Code, Codex and OpenCode",
].join("\n");

// The invocation's --account/--base-url, carried into every suggested command, including
// those in refusals.
let helpCarry = [];

function fail(value, code) {
  // Every refusal says what kind of failure it is (exit 2 is always a usage error).
  if (value && value.ok === false && !value.kind) value = { ok: false, kind: code === 2 ? "usage" : "command_error", ...value };
  if (value && value.ok === false && helpCarry.length) {
    for (const key of ["help", "hint"]) {
      if (Array.isArray(value[key])) value[key] = value[key].map((line) => carrySelectors(line, helpCarry));
      else if (typeof value[key] === "string") value[key] = carrySelectors(value[key], helpCarry);
    }
  }
  output(value);
  process.exit(code);
}

function spawnErrorMessage(error) {
  if (error.code === "ENOENT") {
    return process.env.HEY_BIN
      ? `HEY CLI not found at HEY_BIN=${process.env.HEY_BIN}`
      : "HEY CLI not found on PATH; install it (https://github.com/basecamp/hey-cli) or set HEY_BIN";
  }
  return error.message;
}

// Run HEY with captured output and no stdin. `extra` holds the format flags hey-axi adds.
function runHey(args, extra = ["--json"]) {
  return new Promise((resolve) => {
    const child = spawn(HEY, [...args, ...extra], { stdio: ["ignore", "pipe", "pipe"], env: heyEnv() });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => resolve({ status: 127, error: spawnErrorMessage(error) }));
    // Killed by a signal: no exit status, and not a success.
    child.on("close", (status, signal) => resolve({ status: status ?? (signal ? 1 : 0), signal, stdout, stderr }));
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

// Interactive commands (a person at a terminal): HEY gets the terminal.
function runHeyInteractive(args) {
  return new Promise((resolve) => {
    const child = spawn(HEY, args, { stdio: "inherit" });
    const release = forwardSignals(child);
    child.on("error", (error) => { release(); resolve({ status: 127, error: spawnErrorMessage(error) }); });
    child.on("close", (status, signal) => { release(); resolve({ status: status ?? (signal ? 1 : 0), signal }); });
  });
}

// Raw output (a script, a CSV, --ids-only ...): stdout is held until HEY exits, then
// printed untouched on success. On failure nothing of HEY's is printed; the failure is
// reported as a structured error on stdout instead.
function runHeyRaw(args) {
  return new Promise((resolve) => {
    const child = spawn(HEY, args, { stdio: ["ignore", "pipe", "pipe"], env: heyEnv() });
    const release = forwardSignals(child);
    const out = [];
    let stderr = "";
    child.stdout.on("data", (chunk) => { out.push(chunk); });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { release(); resolve({ status: 127, error: spawnErrorMessage(error) }); });
    child.on("close", (status, signal) => { release(); resolve({ status: status ?? (signal ? 1 : 0), signal, stderr, stdout: Buffer.concat(out) }); });
  });
}

// Run a long-lived NDJSON producer (hey watch), relaying each complete event the moment
// it arrives so consumers never see a partial event: as a TOON block followed by a blank
// line by default, or as HEY's NDJSON line with --json.
function runHeyStream(args, { toon = true } = {}) {
  return new Promise((resolve) => {
    const child = spawn(HEY, args, { stdio: ["ignore", "pipe", "pipe"], env: heyEnv() });
    const release = forwardSignals(child);
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      if (!toon) return process.stdout.write(`${line}\n`);
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        // Not an event: a diagnostic. It goes to stderr, cleaned, never into the stream.
        const clean = cleanLine(line);
        if (clean) process.stderr.write(`hey-axi: ${clean}\n`);
        return undefined;
      }
      process.stdout.write(`${encode(event)}\n\n`);
    });
    // A consumer that stops reading (e.g. `| head -1`) ends the watch cleanly.
    process.stdout.on("error", (error) => {
      if (error.code === "EPIPE") child.kill("SIGTERM");
    });
    child.on("error", (error) => { release(); resolve({ status: 127, error: spawnErrorMessage(error) }); });
    child.on("close", (status, signal) => { release(); lines.close(); resolve({ status: status ?? 0, signal, stderr, stdout: "" }); });
  });
}

// Read the session-end hook's JSON payload from stdin, if one is piped (never waits on a terminal).
function readHookInput() {
  if (process.stdin.isTTY) return {};
  try {
    const text = readFileSync(0, "utf8");
    return text.trim() ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

function scopeDirFor(cwd, findScope) {
  try {
    return findScope(cwd)?.dir || cwd;
  } catch {
    return cwd;
  }
}

export async function main(args = process.argv.slice(2)) {
const manifest = loadBundledManifest();
if (args.length === 0) {
  output(await homeView(runHey));
  process.exit(0);
}
if (args[0] === "--help" || args[0] === "-h") {
  // Top-level help takes nothing else: `hey-axi --help box` is `hey-axi box --help`.
  const rest = args.slice(1).filter((arg) => arg !== "--help" && arg !== "-h");
  if (rest.length && !rest[0].startsWith("-")) {
    args = [...rest, "--help"];
  } else if (rest.length) {
    fail({ ok: false, error: `unknown flag ${rest[0]} for \`hey-axi --help\``, help: ["Run `hey-axi --help` for all commands", "Run `hey-axi <command> --help` for one command"] }, 2);
  } else {
    process.stdout.write(`${usage(manifest)}\n`);
    process.exit(0);
  }
}

// hey-axi's own commands: the session-end hook, `setup hooks` and `setup scope`.
if (args[0] === "hook" && args[1] === "session-end" && args.length === 3 && (args[2] === "--help" || args[2] === "-h")) {
  process.stdout.write(`${HOOK_END_HELP}\n`);
  process.exit(0);
}
if (args[0] === "hook" && args[1] === "session-end" && args.length === 2) {
  const { endSession } = await import("./activity.js");
  const { findScope } = await import("./scope.js");
  const input = readHookInput();
  const cwd = typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd();
  const { sessionIdFrom } = await import("./activity.js");
  const session = [input.session_id, input.sessionID, input.sessionId].find((value) => typeof value === "string" && value) || sessionIdFrom();
  output(endSession(scopeDirFor(cwd, findScope), session));
  process.exit(0);
}
if (args[0] === "setup" && args[1] === "scope") {
  const { SCOPE_HELP, SCOPE_FLAGS, setupScope } = await import("./scope.js");
  const strange = args.slice(2).find((arg) => arg.startsWith("-") && !SCOPE_FLAGS.has(arg.split("=", 1)[0]));
  if (strange) fail({ ok: false, error: `unknown flag ${strange.split("=", 1)[0]} for \`setup scope\``, help: ["valid flags for `setup scope`: --box, --label, --search, --account, --limit, --status, --remove", "Run `hey-axi setup scope --help`"] }, 2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${SCOPE_HELP}\n`);
    process.exit(0);
  }
  const { output: result, code } = setupScope(args.slice(2));
  fail(result, code);
}

const first = scanArgs(args, valueFlagSet(manifest.commands));
for (const name of ["account", "base-url"]) {
  const value = flagValue(args, name);
  if (value !== undefined) helpCarry.push(`--${name}`, shellWord(value));
}
if (first.words[0] === "setup" && first.words[1] === "hooks") {
  const { HOOKS_HELP, setupHooks } = await import("./hooks.js");
  if (first.words.length > 2) fail({ ok: false, error: `unexpected argument "${first.words[2]}" for \`setup hooks\``, help: "Run `hey-axi setup hooks --help`" }, 2);
  // Its flags are all switches: `--remove=false` is refused, not read as --remove.
  const switchValue = first.values.find(([name]) => ["--project", "--status", "--remove"].includes(name));
  if (switchValue) fail({ ok: false, error: `${switchValue[0]} is a switch and takes no value: pass ${switchValue[0]}, or leave it out`, help: "Run `hey-axi setup hooks --help`" }, 2);
  if (first.flags.has("--help") || first.flags.has("-h")) {
    process.stdout.write(`${HOOKS_HELP}\n`);
    process.exit(0);
  }
  const { output: result, code } = await setupHooks(first.flags);
  fail(result, code);
}

if (first.words.length === 0) {
  // Only flags, no command (`hey-axi --account 5`).
  if (first.missing.length) fail({ ok: false, kind: "usage", error: `missing value for ${first.missing.join(", ")}`, help: "Run `hey-axi --help` for all commands" }, 2);
  fail({ ok: false, kind: "usage", error: "no command given", help: ["Run `hey-axi` with no arguments for the home view", "Run `hey-axi --help` for all commands"] }, 2);
}

const resolved = resolveCommand(manifest.commands, first.words);
if (resolved.error) {
  const failure = { ok: false, error: resolved.error };
  if (resolved.path) failure.command = resolved.path;
  if (resolved.word) failure.word = resolved.word;
  if (resolved.subcommands) failure.subcommands = resolved.subcommands;
  let level = manifest.commands;
  if (resolved.path) for (const word of resolved.path.split(" ")) level = level.find((node) => node.name === word)?.subcommands || [];
  const close = closestNames(resolved.word, level);
  failure.help = [
    ...close.map((name) => `Did you mean \`hey-axi ${resolved.path ? `${resolved.path} ` : ""}${name}\`?`),
    resolved.path ? `Run \`hey-axi ${resolved.path} --help\`` : "Run `hey-axi --help` for all commands",
  ];
  fail(failure, 2);
}
const { node, path } = resolved;

// Re-read argv with this command's own value flags, for positionals and flag values.
let scan = scanArgs(args, nodeValueFlags(node));
if (scan.words.slice(0, resolved.consumed).join(" ") !== first.words.slice(0, resolved.consumed).join(" ")) scan = first;
const { flags } = scan;
const positionals = scan.words.slice(resolved.consumed);
const usageLines = (node.synopsis || []).filter((line) => !line.includes("<command>") || !node.usage).map((line) => `usage: ${heyToAxi(line)}`);

const invalid = validateFlags(node, flags, { values: scan.values, missingValues: scan.missing });
if (invalid) {
  const valid = (node.flags || []).map(flagLabel);
  const failure = { ok: false, command: path, kind: "usage" };
  if (invalid.unknown) failure.error = `unknown flag ${invalid.unknown.join(", ")} for \`${path}\``;
  else if (invalid.missingValue) failure.error = `missing value for ${invalid.missingValue.join(", ")} (use ${invalid.missingValue[0]}=<value> if the value starts with "-")`;
  else if (invalid.badValue) failure.error = invalid.badValue;
  else failure.error = `missing required flag ${invalid.missing.join(", ")} for \`${path}\``;
  failure.help = [
    valid.length ? `valid flags for \`${path}\`: ${valid.join(", ")}` : `\`${path}\` takes no flags of its own`,
    `always allowed: ${ALWAYS_ALLOWED}`,
    ...usageLines,
  ];
  fail(failure, 2);
}

if (flags.has("--help") || flags.has("-h")) {
  process.stdout.write(`${commandHelp(node)}\n`);
  process.exit(0);
}

const arity = checkArity(node, positionals, flags);
if (arity) {
  const failure = { ok: false, command: path, kind: "usage", error: arity.error };
  if (node.subcommands?.length && positionals.length === 0) failure.subcommands = node.subcommands.map((child) => child.name);
  const close = node.subcommands?.length && positionals.length ? closestNames(positionals[0], node.subcommands) : [];
  failure.help = [
    ...close.map((name) => `Did you mean \`hey-axi ${path} ${name}\`?`),...usageLines, ...(node.usage ? [`shortcut: hey-axi ${node.usage}`] : []), ...(arity.hint ? [arity.hint] : []), `example: ${examplesFor(node)[0]}`];
  fail(failure, 2);
}

const refusal = checkPolicy(path, flags);
if (refusal) fail({ ok: false, ...refusal }, 2);

const missingContent = contentProblem(node, flags, positionals);
if (missingContent) fail({ ok: false, kind: "usage", ...missingContent }, 2);

let heyArgs = stripAxiFlags(args);
// `--message -` (and --note -, --content -): read the content from stdin.
const fromStdin = scan.values.filter(([name, value]) => STDIN_VALUE_FLAGS.includes(name) && value === "-").map(([name]) => name);
if (fromStdin.length) {
  if (process.stdin.isTTY) fail({ ok: false, kind: "usage", error: `${fromStdin[0]} - reads from stdin, but nothing is piped in`, help: `pipe the text in (e.g. \`cat note.md | hey-axi ${path} ... ${fromStdin[0]} -\`) or pass it as ${fromStdin[0]} "..."` }, 2);
  const text = readFileSync(0, "utf8");
  heyArgs = heyArgs.map((arg, index) => {
    if (arg === "-" && fromStdin.includes(heyArgs[index - 1])) return text;
    const eq = arg.indexOf("=");
    return eq !== -1 && arg.slice(eq + 1) === "-" && fromStdin.includes(arg.slice(0, eq)) ? `${arg.slice(0, eq)}=${text}` : arg;
  });
}

const json = flags.has("--json");
const quiet = flags.has("--quiet");
const full = flags.has("--full");
const raw = hasAny(flags, RAW_OUTPUT_FLAGS);
const command = heyArgs.filter((arg) => arg !== "--json" && arg !== "--quiet");
const fieldsArg = flagValue(args, "fields");
const fields = fieldsArg === undefined ? null : fieldsArg.trim() === "all" ? "all" : fieldsArg.split(",").map((name) => name.trim()).filter(Boolean);
// The command as the agent typed it, minus output/shaping flags, for `--full`/`--all` hints.
const commandLine = ["hey-axi", ...stripAxiFlags(args).filter((arg) => arg !== "--json" && arg !== "--quiet")].map(shellWord).join(" ");
// Selectors to carry into suggested commands.
const carry = [];
for (const name of ["account", "base-url"]) {
  const value = flagValue(args, name);
  if (value !== undefined) carry.push(`--${name}`, shellWord(value));
}
const pageFlags = (node.flags || []).map((flag) => flag.name).filter((name) => ["all", "page", "limit"].includes(name));

// compose/reply without a send opt-in: save a draft instead of sending.
const staging = sendStaging(path, flags);
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

function reportFailure(result) {
  const { failure, exitCode, warnings } = translateFailure(result, { path });
  // The fix-it commands keep the invocation's --account/--base-url.
  for (const key of ["hint", "help"]) {
    if (Array.isArray(failure[key])) failure[key] = failure[key].map((line) => carrySelectors(line, carry));
    else if (failure[key]) failure[key] = carrySelectors(failure[key], carry);
  }
  for (const line of warnings) process.stderr.write(`${line}\n`);
  const noop = exitCode !== 0 && noopFor(path, failure, positionals, { to: flagValue(args, "to"), from: flagValue(args, "from") });
  if (noop) {
    if (json) process.stdout.write(`${JSON.stringify(noop)}\n`);
    else output(noop);
    process.exit(0);
  }
  if (json) process.stdout.write(`${JSON.stringify(failure)}\n`);
  else output(failure);
  process.exit(exitCode);
}

const mode = runMode(path, flags);
if (mode === "interactive") {
  // Only reached with the explicit --interactive opt-in (and a terminal, except for mcp).
  const result = await runHeyInteractive(heyArgs);
  if (result.error) reportFailure(result);
  process.exit(result.status === 0 ? 0 : 1);
}
if (raw || mode !== "json") {
  // stream: watch; raw: scripts, CSV, and --ids-only/--count/--markdown/--html/--styled/--jq.
  const result = mode === "stream" ? await runHeyStream(heyArgs, { toon: !json }) : await runHeyRaw(heyArgs);
  // A watch stopped by a signal ended the way the agent asked: not an error.
  if (mode === "stream" && (result.signal || result.status === 130 || result.status === 143)) process.exit(0);
  // HEY's stdout here is data, not an error message: it never goes into the failure.
  if (result.error || result.status !== 0) reportFailure({ ...result, stdout: "" });
  writeWarnings(result.stderr);
  if (mode !== "stream" && result.stdout?.length) process.stdout.write(result.stdout);
  process.exit(0);
}

// `hey-axi version`: hey-axi's own version next to HEY's.
if (path === "version") {
  const result = await runHey(command, ["--json"]);
  const versions = { hey_axi: VERSION };
  if (result.status !== 0) {
    // hey-axi still knows its own version; the failure says what's wrong with HEY.
    const { failure, exitCode } = translateFailure(result, { path });
    fail({ ok: false, hey_axi: VERSION, ...failure }, exitCode);
  }
  try {
    const parsed = JSON.parse(result.stdout);
    const data = parsed && typeof parsed === "object" && "data" in parsed ? parsed.data : parsed;
    versions.hey = data?.version ?? data;
    if (data?.commit) versions.hey_commit = data.commit;
  } catch {
    versions.hey = cleanLine(result.stdout);
  }
  if (json) process.stdout.write(`${JSON.stringify(versions)}\n`);
  else output(versions);
  process.exit(0);
}

const result = await runHey(command, ["--json"]);
if (result.status !== 0) reportFailure(result);
writeWarnings(result.stderr);

let parsed;
let plainText = false;
try {
  parsed = JSON.parse(result.stdout);
} catch {
  plainText = true;
  // HEY succeeded but printed text: show it, cleaned and cut, rather than fail.
  const text = String(result.stdout || "").trim();
  if (!text) parsed = { ok: true, result: "done (HEY printed nothing)" };
  else if (full || text.length <= 1000) parsed = { ok: true, output: text };
  else parsed = { ok: true, output: `${text.slice(0, 1000)}… (truncated, ${text.length} chars total)`, help: [`Run \`${commandLine} --full\` to see the complete output`] };
}

let shaped;
try {
  shaped = full || plainText ? parsed : shapeEnvelope(parsed, { path, fields, commandLine, carry, pageFlags, quiet, all: flags.has("--all") });
} catch (error) {
  if (!(error instanceof FieldError)) throw error;
  fail({
    ok: false,
    kind: "usage",
    error: `unknown field ${error.unknown.join(", ")} for \`${path}\``,
    help: [`available fields: ${error.available.join(", ")}`, "dotted paths (creator.email_address) and --fields all also work"],
  }, 2);
}
shaped = markStaged(shaped);

// A list whose HEY result carried no next steps still gets one (AXI principle 9): the
// matching view/show command when there is one, else how to see every field.
if (!full && !quiet && !plainText && shaped && typeof shaped === "object" && shaped.count !== undefined) {
  const help = Array.isArray(shaped.help) ? shaped.help : [];
  const hasNext = help.some((line) => /^Run `hey-axi /.test(line) && !/ --(all|full|page|limit)\b/.test(line));
  if (!hasNext) {
    const words = path.split(" ");
    const parent = resolveCommand(manifest.commands, words.slice(0, -1));
    const siblings = words.length > 1 && !parent.error ? parent.node.subcommands || [] : [];
    // After an empty list, suggest creating; after a list, suggest viewing.
    const wanted = shaped.empty ? ["create", "add"] : ["view", "show", "read"];
    const sibling = wanted.map((name) => siblings.find((child) => child.name === name && child.path !== path)).find(Boolean);
    const next = sibling && shaped.empty
      ? `Run \`${withSelectors(`hey-axi ${sibling.path} --help`, carry)}\` to see how to add one`
      : sibling
      ? `Run \`${withSelectors(`hey-axi ${sibling.path} <id>`, carry)}\` to see one in full`
      : shaped.empty ? `Run \`${withSelectors(`hey-axi ${path} --help`, carry)}\` to check the filters` : `Run \`${commandLine} --fields all\` to see every field`;
    shaped.help = [next, ...help];
  }
}

const { recordActivity } = await import("./activity.js");
const { findScope } = await import("./scope.js");
recordActivity({ path, positionals, staged: Boolean(staging), sent: sendCommands().includes(path) && !staging && !flags.has("--draft") && !flags.has("--dry-run"), scopeDir: scopeDirFor(process.cwd(), findScope) });

if (json) process.stdout.write(`${JSON.stringify(shaped)}\n`);
else output(shaped);
}
