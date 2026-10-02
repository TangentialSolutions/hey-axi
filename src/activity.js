// Session lifecycle capture (AXI principle 7). Once `hey-axi setup hooks` has been run,
// hey-axi notes what it did in each directory scope (command paths and numeric ids only:
// no subjects, bodies or addresses) in a local journal. The session-end hook
// (`hey-axi hook session-end`) folds the journal into a one-line summary of the session,
// and the next session's home view shows it, so new sessions start knowing which drafts
// are waiting and what was already triaged. `setup hooks --remove` turns capture off and
// deletes the journal.
//
// State lives in $HEY_AXI_STATE_DIR, else $XDG_STATE_HOME/hey-axi, else ~/.local/state/hey-axi.

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

export function stateDir(env = process.env) {
  if (env.HEY_AXI_STATE_DIR) return env.HEY_AXI_STATE_DIR;
  return join(env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "hey-axi");
}

const files = (dir = stateDir()) => ({
  dir,
  enabled: join(dir, "capture-enabled"),
  journal: join(dir, "activity.jsonl"),
  sessions: join(dir, "sessions"),
});

export function captureEnabled() {
  return existsSync(files().enabled);
}

export function enableCapture() {
  const f = files();
  mkdirSync(f.dir, { recursive: true });
  if (existsSync(f.enabled)) return false;
  writeFileSync(f.enabled, "hey-axi session capture is on; `hey-axi setup hooks --remove` turns it off\n");
  return true;
}

export function disableCapture() {
  const f = files();
  const had = existsSync(f.enabled) || existsSync(f.journal) || existsSync(f.sessions);
  rmSync(f.enabled, { force: true });
  rmSync(f.journal, { force: true });
  rmSync(f.sessions, { recursive: true, force: true });
  return had;
}

const scopeKey = (scopeDir) => createHash("sha256").update(scopeDir).digest("hex").slice(0, 16);

const READ_WORDS = new Set(["list", "view", "show", "read", "status", "history", "categories", "current", "filters", "preview", "senders", "token", "day", "week", "trusted-locals"]);
const READ_COMMANDS = new Set(["search", "box", "label", "collection", "bundle", "workflow", "set-aside", "set-aside group", "doctor", "version", "commands", "config show"]);

// "read", "mutation" or null (not worth remembering).
export function activityKind(path) {
  if (path === "thread read") return "read";
  const last = path.split(" ").pop();
  if (READ_WORDS.has(last) || READ_COMMANDS.has(path) || path.startsWith("auth") || path.startsWith("setup") || path.startsWith("shell-completion") || path === "watch") return null;
  return "mutation";
}

// Append one entry. Never throws: capture must not break a command.
export function recordActivity({ path, positionals = [], staged = false, sent = false, scopeDir }) {
  try {
    if (!captureEnabled()) return;
    const kind = staged ? "draft" : sent ? "sent" : activityKind(path);
    if (!kind) return;
    const ids = positionals.filter((word) => /^\d+$/.test(word)).slice(0, 20);
    const f = files();
    appendFileSync(f.journal, `${JSON.stringify({ at: new Date().toISOString(), scope: scopeKey(scopeDir), path, kind, ids })}\n`);
  } catch {
    // capture is best-effort
  }
}

function readJournal(f) {
  if (!existsSync(f.journal)) return [];
  return readFileSync(f.journal, "utf8").split("\n").filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

function summarize(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const key = entry.kind === "draft" ? `${entry.path} (saved as draft, not sent)` : entry.kind === "sent" ? `${entry.path} (sent)` : entry.path;
    const group = groups.get(key) || { count: 0, ids: [] };
    group.count += 1;
    group.ids.push(...entry.ids);
    groups.set(key, group);
  }
  return [...groups].map(([key, { count, ids }]) => {
    const shown = [...new Set(ids)].slice(0, 5);
    return `${key} ×${count}${shown.length ? ` [${shown.join(", ")}${ids.length > shown.length ? ", …" : ""}]` : ""}`;
  }).join("; ");
}

// The session-end hook: fold this scope's journal entries into its last-session summary.
// A session with no hey-axi activity leaves the previous summary in place.
export function endSession(scopeDir) {
  const f = files();
  if (!existsSync(f.enabled)) return { captured: 0 };
  const key = scopeKey(scopeDir);
  const entries = readJournal(f);
  const mine = entries.filter((entry) => entry.scope === key);
  if (!mine.length) return { captured: 0 };
  mkdirSync(f.sessions, { recursive: true });
  const summary = {
    ended_at: new Date().toISOString(),
    started_at: mine[0].at,
    summary: summarize(mine),
    drafts: mine.filter((entry) => entry.kind === "draft").length,
  };
  writeFileSync(join(f.sessions, `${key}.json`), `${JSON.stringify(summary)}\n`);
  const rest = entries.filter((entry) => entry.scope !== key);
  writeFileSync(f.journal, rest.map((entry) => `${JSON.stringify(entry)}\n`).join(""));
  return { captured: mine.length };
}

function localTime(iso) {
  const date = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())} (UTC${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)})`;
}

// { line, drafts } for the home view, or null.
export function lastSession(scopeDir) {
  try {
    const f = files();
    if (!existsSync(f.enabled)) return null;
    const path = join(f.sessions, `${scopeKey(scopeDir)}.json`);
    if (!existsSync(path)) return null;
    const summary = JSON.parse(readFileSync(path, "utf8"));
    return { line: `ended ${localTime(summary.ended_at)}: ${summary.summary}`, drafts: summary.drafts };
  } catch {
    return null;
  }
}
