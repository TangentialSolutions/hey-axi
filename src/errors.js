// Turn a failed HEY run into hey-axi's error shape (AXI principle 6):
//   - HEY's own error envelope ({ok:false,error,code,hint,meta}) is kept, with hints
//     rewritten to name hey-axi commands
//   - anything else is translated: one cleaned line of HEY's text (no warnings, stack
//     frames or terminal escapes) under a hey-axi message for the failure kind
//   - plain warning lines HEY prints first (e.g. about the keyring) go to stderr, not stdout
//   - exit codes follow AXI: 2 for usage errors, 1 for everything else that failed
// A `help` line always says what to do next.

import { heyToAxi } from "./text.js";

// HEY's exit codes (`hey help exit-codes`) → a kind, a message and the next step.
const KINDS = {
  1: { kind: "command_error", message: "the command failed", help: "Run `hey-axi <command> --help` to check the arguments" },
  2: { kind: "not_found", message: "not found", help: "Check the id; list commands such as `hey-axi box view imbox` show valid ids (threads use topic_id)" },
  3: { kind: "auth", message: "not signed in to HEY", help: "Run `hey-axi auth login --token <token>` if you have a token; otherwise ask the user to run `hey-axi auth login --interactive` in their terminal. Check with `hey-axi auth status`" },
  4: { kind: "forbidden", message: "this account can't do that", help: "Check `hey-axi account list` and --account" },
  5: { kind: "rate_limited", message: "rate limited by HEY", help: "Wait a minute, then retry" },
  6: { kind: "network", message: "couldn't reach HEY", help: "Check the network connection, then retry" },
  7: { kind: "api_error", message: "HEY's API returned an error", help: "Retry later, or run `hey-axi doctor`" },
  8: { kind: "ambiguous", message: "more than one match", help: "Pass an exact id instead of a name" },
  127: { kind: "hey_missing", message: "HEY CLI not found", help: "Install the HEY CLI (curl -fsSL https://hey.com/install-cli | bash) or set HEY_BIN" },
};

const USAGE_CODES = new Set(["usage", "invalid_argument", "invalid_flag", "validation"]);

// AXI exit code for a failed HEY run.
export function axiExitCode(status, code) {
  if (status === 0) return 0;
  if (USAGE_CODES.has(code)) return 2;
  return 1;
}

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const NOISE = /^(warning:|panic:|fatal error:|\[signal |runtime error|\s+at |goroutine \d|\s*[\w./-]+\.go:\d+|exit status \d+$|\[\w+\]\s)/i;

// The one line of HEY's plain-text output worth showing an agent.
export function cleanLine(text) {
  const lines = String(text || "").replace(ANSI, "").split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim() && !NOISE.test(line));
  if (!lines.length) return "";
  const line = lines[0].trim().replace(/^(error|Error|ERROR):\s*/, "");
  return heyToAxi(line.length > 200 ? `${line.slice(0, 200)}…` : line);
}

// HEY's stderr after a successful run, minus terminal escapes and debug noise (stack
// frames, panics): warnings and notices such as `next_page: …` stay, on stderr.
export function warningLines(text) {
  return String(text || "").replace(ANSI, "").split(/\r?\n/).map((line) => line.trimEnd())
    .filter((line) => line.trim() && (/^warning:/i.test(line.trim()) || !NOISE.test(line)))
    .map((line) => heyToAxi(line));
}

// Keys in HEY's error meta that only carry debugging detail.
const DEBUG_KEYS = /stack|trace|backtrace|panic|goroutine|debug|caller|frames?$/i;

// HEY's error meta without debugging detail: stack-like keys are dropped and
// multi-line strings are cut to their one meaningful line.
export function cleanMeta(value, depth = 0) {
  if (typeof value === "string") return /[\r\n\u001b]/.test(value) || value.length > 200 ? cleanLine(value) : value;
  if (!value || typeof value !== "object" || depth > 3) return depth > 3 ? undefined : value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => cleanMeta(item, depth + 1)).filter((item) => item !== undefined && item !== "");
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (DEBUG_KEYS.test(key)) continue;
    const cleaned = cleanMeta(item, depth + 1);
    if (cleaned !== undefined && cleaned !== "") out[key] = cleaned;
  }
  return Object.keys(out).length ? out : undefined;
}

function warnings(text) {
  return String(text || "").replace(ANSI, "").split(/\r?\n/).filter((line) => /^warning:/i.test(line.trim())).map((line) => line.trim());
}

function findEnvelope(text) {
  if (!text) return null;
  const starts = [];
  if (text.trimStart().startsWith("{")) starts.push(text.indexOf("{"));
  for (let i = text.indexOf("\n{"); i !== -1; i = text.indexOf("\n{", i + 1)) starts.push(i + 1);
  for (const start of starts) {
    try {
      const parsed = JSON.parse(text.slice(start));
      if (parsed && typeof parsed === "object" && parsed.ok === false && parsed.error) {
        return { envelope: parsed, prefix: text.slice(0, start).trim() };
      }
    } catch {
      // not an envelope from here; try the next candidate
    }
  }
  return null;
}

// Returns { failure, exitCode, warnings }: the object to print, hey-axi's exit code,
// and diagnostic lines for stderr.
export function translateFailure(result, { path } = {}) {
  const raw = KINDS[result.status] || KINDS[1];
  const info = path ? { ...raw, help: raw.help.replace("<command>", path) } : raw;
  if (result.error) {
    return { failure: { ok: false, error: result.error, kind: info.kind, help: info.help }, exitCode: 1, warnings: [] };
  }
  for (const text of [result.stderr, result.stdout]) {
    const found = findEnvelope(text);
    if (!found) continue;
    const { envelope } = found;
    // Even HEY's own envelope is translated: one clean line, no stack frames or escapes.
    const failure = { ok: false, error: cleanLine(String(envelope.error)) || info.message, kind: info.kind };
    if (envelope.code !== undefined && envelope.code !== "" && envelope.code !== "unknown") failure.code = String(envelope.code);
    const meta = envelope.meta === undefined || envelope.meta === "" ? undefined : cleanMeta(envelope.meta);
    if (meta !== undefined) failure.meta = meta;
    const usage = USAGE_CODES.has(envelope.code) || /^usage: /i.test(String(envelope.error));
    if (usage) failure.kind = "usage";
    const hint = envelope.hint ? cleanLine(String(envelope.hint)) : "";
    if (hint && !/^Run 'hey(-axi)? --help'/.test(hint)) failure.hint = hint;
    failure.help = usage ? `Run \`hey-axi ${path || "<command>"} --help\` for its arguments and flags` : info.help;
    return { failure, exitCode: usage ? 2 : axiExitCode(result.status, envelope.code), warnings: warnings(found.prefix) };
  }
  const detail = cleanLine(result.stderr) || cleanLine(result.stdout);
  const failure = { ok: false, error: detail ? `${info.message}: ${detail}` : info.message, kind: info.kind, help: info.help };
  return { failure, exitCode: axiExitCode(result.status), warnings: [...warnings(result.stderr), ...warnings(result.stdout)] };
}

// Kept for callers that only need the object (the home view).
export function heyFailure(result) {
  return translateFailure(result).failure;
}
