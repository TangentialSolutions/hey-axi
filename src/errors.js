// Turn a failed HEY run into hey-axi's error shape, keeping HEY's own error envelope
// ({ok:false,error,code,hint,meta}, written to stderr in --json mode) when there is one.
// HEY may print plain warning lines (e.g. about the keyring) before the envelope; those
// are kept as `warning`. Suggestions name hey-axi commands, and when HEY gives no hint
// a `help` line for the exit code says what to do next.

import { heyToAxi } from "./text.js";

// HEY's exit codes (`hey help exit-codes`) → the next step for an agent.
const NEXT_STEP = {
  1: "Run `hey-axi <command> --help` to check the arguments",
  2: "Check the id; list commands such as `hey-axi box view imbox` show valid ids (threads use topic_id)",
  3: "Ask the user to run `hey auth login` in their terminal, then `hey-axi auth status`",
  4: "This account can't do that; check `hey-axi account list` and --account",
  5: "Rate limited by HEY: wait a minute, then retry",
  6: "Network problem reaching HEY: check the connection, then retry",
  7: "HEY's API returned an error: retry later, or run `hey-axi doctor`",
  8: "More than one match: pass an exact id instead of a name",
  127: "Install the HEY CLI (curl -fsSL https://hey.com/install-cli | bash) or set HEY_BIN",
};

function withHelp(failure) {
  if (failure.hint) failure.hint = heyToAxi(failure.hint);
  else if (NEXT_STEP[failure.exit_code]) failure.help = NEXT_STEP[failure.exit_code];
  return failure;
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

export function heyFailure(result) {
  if (result.error) return withHelp({ ok: false, error: result.error, exit_code: result.status });
  for (const text of [result.stderr, result.stdout]) {
    const found = findEnvelope(text);
    if (!found) continue;
    const failure = { ok: false, error: found.envelope.error };
    for (const key of ["code", "hint", "meta"]) {
      if (found.envelope[key] !== undefined && found.envelope[key] !== "") failure[key] = found.envelope[key];
    }
    if (found.prefix) failure.warning = found.prefix;
    failure.exit_code = result.status;
    return withHelp(failure);
  }
  const message = (result.stderr || "").trim() || (result.stdout || "").trim() || "hey command failed";
  return withHelp({ ok: false, error: message, exit_code: result.status });
}
