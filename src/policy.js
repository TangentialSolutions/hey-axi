// What hey-axi will and won't run, beyond "is it a HEY command".

// hey-axi's own flags. Stripped before anything is forwarded to HEY.
export const AXI_FLAGS = ["--allow-send", "--allow-secret"];

// Commands that deliver email.
//   safe:  HEY flags that already mean nothing is sent
//   stage: the flag hey-axi adds, when there's no send opt-in, to save a draft instead
//   why:   for commands with no draft mode, why hey-axi refuses and what to do instead
const SEND_COMMANDS = new Map([
  ["compose", { safe: ["--draft"], stage: "--draft" }],
  ["reply", { safe: ["--draft", "--dry-run"], stage: "--draft" }],
  ["forward", { safe: [], why: "HEY has no draft mode for forward", instead: "use `hey-axi reply <id> --to <addr>` (staged as a draft) or pass --allow-send" }],
  ["draft send", { safe: [], why: "this delivers an existing draft and has no draft mode", instead: "review it with `hey-axi draft show <id>`, then pass --allow-send" }],
  ["bulk-reply send", { safe: [], why: "HEY has no draft mode for bulk replies", instead: "check it with `hey-axi bulk-reply preview <ids>`, then pass --allow-send" }],
]);

export const DRAFT_NOTICE = "Saved as a DRAFT. Nothing was sent. Pass --allow-send (or set HEY_AXI_ALLOW_SEND=1) to really send.";

// Commands that print a credential into the agent's context.
const SECRET_COMMANDS = new Set(["auth token"]);

// How a command runs. Anything not listed is "json": captured, parsed, rendered as TOON.
//   stream: long-running NDJSON, relayed event by event as it arrives (TOON, or NDJSON with --json)
//   raw:    prints non-JSON (a script, a CSV); relayed untouched
// Captured runs give HEY a closed stdin and HEY_NONINTERACTIVE=1, so it can never prompt.
const STREAM = new Set(["watch"]);
const RAW = new Set(["shell-completion generate"]);

// Commands that only work with a person at a terminal (a full-screen UI, a browser
// sign-in, a wizard) or that hand stdio to another program (an MCP server). hey-axi never
// runs them by default, TTY or not, so nothing can stop and wait for input. They run
// only with the explicit `--interactive` opt-in, which hands HEY the terminal; the
// person-facing ones also need a real terminal on stdin and stdout.
const USER_ONLY = {
  tui: { reason: "it is a full-screen terminal UI", hint: "ask the user to run `hey-axi tui --interactive` in their own terminal" },
  mcp: { reason: "it is a long-running MCP server that takes over stdin/stdout", hint: "to use it as an MCP server, register `hey-axi mcp --interactive` in the agent's MCP settings", tty: false },
  setup: { reason: "it is the first-run wizard (browser sign-in and prompts)", hint: "ask the user to run `hey-axi setup --interactive` in their terminal; `hey-axi setup agents`, `setup claude` and `setup codex` run without prompts" },
  "auth login": { reason: "it opens a browser and waits for the user", hint: "pass --token <token>, or ask the user to run `hey-axi auth login --interactive` in their terminal", unless: ["--token", "--cookie"] },
  login: { reason: "it opens a browser and waits for the user", hint: "pass --token <token>, or ask the user to run `hey-axi login --interactive` in their terminal", unless: ["--token", "--cookie"] },
};

const personCommand = (path, flags) => Boolean(USER_ONLY[path]) && !USER_ONLY[path].unless?.some((flag) => flags.has(flag));

export function runMode(path, flags) {
  if (personCommand(path, flags) && flags.has("--interactive")) return "interactive";
  if (STREAM.has(path)) return "stream";
  if (RAW.has(path)) return "raw";
  // CSV goes to stdout unless --output names a file (then HEY answers with JSON).
  if (path === "timetrack export" && !flags.has("--output") && !flags.has("-o")) return "raw";
  return "json";
}

export function userOnly(path, flags = new Set(), io = { stdin: process.stdin.isTTY, stdout: process.stdout.isTTY }) {
  if (!personCommand(path, flags)) {
    if (!flags.has("--interactive")) return null;
    return { error: "--interactive does not apply here", command: path, reason: `only ${Object.keys(USER_ONLY).join(", ")} (without --token) take over the terminal`, hint: `run \`hey-axi ${path}\` without --interactive` };
  }
  const rule = USER_ONLY[path];
  if (!flags.has("--interactive")) return { error: "needs the user", command: path, reason: rule.reason, hint: rule.hint };
  if (rule.tty !== false && !(io.stdin && io.stdout)) {
    return { error: "needs the user", command: path, reason: `${rule.reason}, and --interactive needs a terminal on stdin and stdout`, hint: rule.hint };
  }
  return null;
}

export function userOnlyPaths() {
  return Object.keys(USER_ONLY);
}

// Commands that fall back to opening $EDITOR when no content is given. hey-axi requires
// the content up front (exit 2) so nothing ever waits on an editor. `--message -` (and
// --note -, --content -) reads the content from stdin.
export const STDIN_VALUE_FLAGS = ["--message", "-m", "--message-html", "--note", "--note-html", "--content", "--content-html"];
const DATE_LIKE = /^(\d{4}-\d{2}-\d{2}|today|yesterday|tomorrow|(last|next|this)[ _-]\w+|mon|tue|wed|thu|fri|sat|sun)\w*$/i;
const CONTENT = {
  compose: { flags: ["--message", "-m", "--message-html", "--attach"], what: "a message", hint: "pass --message \"...\" (or --message - to read it from stdin)" },
  reply: { flags: ["--message", "-m", "--message-html", "--attach", "--dry-run"], what: "a message", hint: "pass --message \"...\" (or --message - to read it from stdin); --dry-run previews without one" },
  "bulk-reply send": { flags: ["--message", "-m", "--message-html", "--attach"], what: "a message", hint: "pass --message \"...\" (or --message - to read it from stdin)" },
  "contact note set": { flags: ["--note", "--note-html"], positional: (words) => words.length >= 2, what: "the note", hint: "pass --note \"...\" (or the note as a second argument, or --note - for stdin)" },
  "journal write": { flags: ["--content", "--content-html"], positional: (words) => words.length >= 2 || (words.length === 1 && !DATE_LIKE.test(words[0])), what: "the entry", hint: "pass --content \"...\" (or --content - to read it from stdin)" },
  "draft edit": { own: true, what: "a field to change", hint: "pass the fields to change, e.g. --message \"...\" or --subject \"...\"" },
};

// Returns null, or a refusal when the command would open an editor.
export function contentProblem(node, flags, positionals = []) {
  const rule = CONTENT[node.path];
  if (!rule) return null;
  // Shorthands count as their long flag (`-n` is --note for contact note set).
  const has = (name) => flags.has(name) || (node.flags || []).some((flag) => `--${flag.name}` === name && flag.shorthand && flags.has(`-${flag.shorthand}`));
  if (rule.own) {
    if ((node.flags || []).some((flag) => has(`--${flag.name}`))) return null;
  } else if (rule.flags.some(has) || rule.positional?.(positionals)) return null;
  return { error: `missing ${rule.what} for \`${node.path}\``, command: node.path, reason: "without it HEY would open an editor and wait", hint: rule.hint };
}

// Mutations whose desired end state may already hold. Only these commands can become a
// no-op, and only when HEY's failure says that exact end state already holds (each
// command has its own pattern; a generic "conflict" is not enough). Send, reply and read
// commands never become no-ops. Deletes are idempotent too: deleting something that
// is not there is a no-op.
// Each delete, and the words HEY uses for its target. A not-found that names something
// else ("calendar not found" for todo delete) is not a no-op.
const DELETES = new Map([
  ["draft delete", /\bdraft/i], ["event delete", /\bevent/i], ["todo delete", /\btodo/i], ["habit delete", /\bhabit/i],
  ["clip delete", /\bclip/i], ["snippet delete", /\bsnippet/i], ["timetrack delete", /\b(time ?track|track|entry)/i],
  ["timetrack category delete", /\bcategor/i], ["workflow delete", /\bworkflow/i], ["workflow stage delete", /\bstage/i],
  ["set-aside group delete", /\bgroup/i], ["contact note delete", /\bnote/i],
]);
const GENERIC_NOT_FOUND = /^\s*(the )?((requested )?(resource|record|item|object) )?(was )?not found\.?\s*$|^\s*404\b/i;
const ADDED = /\balready (in|on|has|have|added|labell?ed|a member|part of|belongs?)\b/i;
const REMOVED = /\b(not (in|on|labell?ed|a member|part of)|already removed|isn'?t (in|on|labell?ed))\b/i;
export const END_STATES = {
  "todo complete": /\balready (been )?completed?\b/i,
  "habit complete": /\balready (been )?completed?\b/i,
  "todo uncomplete": /\b(already (incomplete|uncompleted|not completed?)|not (yet )?completed?)\b/i,
  "habit uncomplete": /\b(already (incomplete|uncompleted|not completed?)|not (yet )?completed?)\b/i,
  seen: /\balready (seen|read|marked (as )?(seen|read))\b/i,
  unseen: /\balready (unseen|unread|marked (as )?(unseen|unread))\b/i,
  move: /\balready in\b/i,
  "label add": ADDED, "collection add": ADDED, "set-aside group add": ADDED, "workflow add": ADDED,
  "label remove": REMOVED, "collection remove": REMOVED, "set-aside group remove": REMOVED, "workflow remove": REMOVED,
  "screener approve": /\balready (screened in|approved)\b/i,
  "screener deny": /\balready (screened out|denied)\b/i,
  "screener clear": /\b(already cleared|not screened)\b/i,
  "contact hide": /\balready hidden\b/i,
  "contact show-again": /\b(already (shown|visible)|not hidden)\b/i,
  "contact bundle": /\balready bundled\b/i,
  "contact unbundle": /\b(already unbundled|not bundled)\b/i,
  ignore: /\balready ignor/i,
  "stop-ignoring": /\b(not ignor|already (unignored|not ignored))/i,
  spam: /\balready (in |marked (as )?)?spam\b/i,
  trash: /\balready (in (the )?)?trash(ed)?\b/i,
  "bubble up": /\balready bubbled\b/i,
  "bubble pop": /\b(already popped|not bubbled)\b/i,
  "timetrack start": /\balready (running|started|tracking)\b/i,
  "timetrack stop": /\bno (time ?track|timer|track)[^.]*running\b|\bnot running\b|\balready stopped\b/i,
  "account use": /\balready (using|the default|selected)\b/i,
  "config trust-local": /\balready trusted\b/i,
  "config untrust-local": /\b(not trusted|already untrusted)\b/i,
  share: /\balready shared\b/i,
  unshare: /\b(not shared|already unshared)\b/i,
};
// Creates are not on the list: "already exists" doesn't say the existing one has the
// settings asked for, so it stays an error the agent can check.

// Commands whose end state names a destination: the failure must name the same one.
const DESTINATION = { move: "to" };

export function noopFor(path, failure, positionals = [], values = {}) {
  const text = `${failure.error || ""} ${failure.hint || ""}`;
  const target = positionals.length ? ` ${positionals.join(" ")}` : "";
  if (DELETES.has(path) && failure.kind === "not_found" && (GENERIC_NOT_FOUND.test(failure.error || "") || DELETES.get(path).test(failure.error || ""))) {
    return { ok: true, noop: true, command: path, result: `nothing to delete:${target || " it"} is already gone (no-op)`, note: "if you expected it to exist, check the id with the matching list command" };
  }
  const endState = END_STATES[path];
  const destination = DESTINATION[path] ? values[DESTINATION[path]] : undefined;
  if (DESTINATION[path] && (!destination || !text.toLowerCase().includes(String(destination).toLowerCase()))) return null;
  // A failure that also reports a failed part ("1 already seen; 2 failed") is not a no-op.
  if (/\b(failed|cannot|can'?t|could ?n[o']t|unable|error)\b/i.test(failure.error || "")) return null;
  if (endState && failure.kind !== "auth" && failure.kind !== "forbidden" && failure.kind !== "not_found" && endState.test(text)) {
    return { ok: true, noop: true, command: path, result: `already done${target ? ` for${target}` : ""} (no-op)`, detail: failure.error };
  }
  return null;
}

export function interactivePaths() {
  return userOnlyPaths();
}

const truthy = (value) => ["1", "true", "yes"].includes(String(value || "").toLowerCase());

export function sendCommands() {
  return [...SEND_COMMANDS.keys()];
}

function sendAllowed(flags, env) {
  return flags.has("--allow-send") || truthy(env.HEY_AXI_ALLOW_SEND);
}

// For a send command with a draft mode and no opt-in, return the flag to add so HEY
// saves a draft instead of sending. Returns null when nothing needs staging.
export function sendStaging(path, flags, env = process.env) {
  const rule = SEND_COMMANDS.get(path);
  if (!rule?.stage || sendAllowed(flags, env) || rule.safe.some((flag) => flags.has(flag))) return null;
  return { flag: rule.stage, notice: DRAFT_NOTICE };
}

// Returns null when the command may run, or a structured refusal.
export function checkPolicy(path, flags, env = process.env, io = { stdin: process.stdin.isTTY, stdout: process.stdout.isTTY }) {
  const person = userOnly(path, flags, io);
  if (person) return person;

  if (SEND_COMMANDS.has(path)) {
    const rule = SEND_COMMANDS.get(path);
    if (!rule.stage && !sendAllowed(flags, env)) {
      return {
        error: "send blocked",
        command: path,
        reason: `this command delivers email, and ${rule.why}`,
        hint: rule.instead,
      };
    }
  }

  if (SECRET_COMMANDS.has(path) && !(flags.has("--allow-secret") || truthy(env.HEY_AXI_ALLOW_SECRETS))) {
    return {
      error: "secret output blocked",
      command: path,
      reason: "prints an access token",
      hint: "pass --allow-secret (or set HEY_AXI_ALLOW_SECRETS=1) if you really need it",
    };
  }
  return null;
}
