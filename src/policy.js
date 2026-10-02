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
//   stream: long-running NDJSON, relayed line by line as it arrives
//   raw:    prints non-JSON (a script, a CSV); relayed untouched
// Captured runs give HEY a closed stdin and HEY_NONINTERACTIVE=1, so it can never prompt.
const STREAM = new Set(["watch"]);
const RAW = new Set(["shell-completion generate"]);

// Commands that only work with a person at a terminal (a full-screen UI, a browser
// sign-in, a wizard, a long-running stdio server). Without a terminal on both stdin and
// stdout (an agent's shell) hey-axi refuses them before HEY runs, naming the command
// the user can run themselves or the non-interactive form. With a terminal (a person),
// HEY gets the terminal.
const USER_ONLY = {
  tui: { reason: "it is a full-screen terminal UI", hint: "ask the user to run `hey-axi tui` in their own terminal" },
  mcp: { reason: "it is a long-running MCP server for agent harnesses, not a shell command", hint: "ask the user to add `hey-axi mcp` as an MCP server in the agent's settings" },
  setup: { reason: "it is the first-run wizard (browser sign-in and prompts)", hint: "ask the user to run `hey-axi setup` in their terminal; `hey-axi setup agents`, `setup claude` and `setup codex` run without prompts" },
  "auth login": { reason: "it opens a browser and waits for the user", hint: "ask the user to run `hey-axi auth login` in their terminal, or pass --token <token>", unless: ["--token", "--cookie"] },
  login: { reason: "it opens a browser and waits for the user", hint: "ask the user to run `hey-axi login` in their terminal, or pass --token <token>", unless: ["--token", "--cookie"] },
};

export function runMode(path, flags) {
  if (USER_ONLY[path] && !USER_ONLY[path].unless?.some((flag) => flags.has(flag))) return "interactive";
  if (STREAM.has(path)) return "stream";
  if (RAW.has(path)) return "raw";
  // CSV goes to stdout unless --output names a file (then HEY answers with JSON).
  if (path === "timetrack export" && !flags.has("--output") && !flags.has("-o")) return "raw";
  return "json";
}

export function userOnly(path, flags = new Set(), io = { stdin: process.stdin.isTTY, stdout: process.stdout.isTTY }) {
  const rule = USER_ONLY[path];
  if (!rule || rule.unless?.some((flag) => flags.has(flag)) || (io.stdin && io.stdout)) return null;
  return { error: "needs the user", command: path, reason: rule.reason, hint: rule.hint };
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

// Mutations whose desired end state may already hold. When HEY reports that (an
// "already ..." failure), hey-axi answers with a no-op success instead of an error.
// Deletes are idempotent too: deleting something that is not there is a no-op.
const DELETES = new Set(["draft delete", "event delete", "todo delete", "habit delete", "clip delete", "snippet delete", "timetrack delete", "timetrack category delete", "workflow delete", "workflow stage delete", "set-aside group delete", "contact note delete"]);
const ALREADY = /\balready\b|\bno changes?\b|\bnot changed\b|\bunchanged\b|\bnothing to\b/i;
const NOT_RUNNING = { "timetrack stop": /no (time ?track|timer|track)[^.]*running|not running/i };

export function noopFor(path, failure, positionals = []) {
  const text = `${failure.error || ""} ${failure.hint || ""}`;
  const target = positionals.length ? ` ${positionals.join(" ")}` : "";
  if (DELETES.has(path) && (failure.kind === "not_found")) {
    return { ok: true, noop: true, command: path, result: `nothing to delete:${target || " it"} is already gone (no-op)`, note: "if you expected it to exist, check the id with the matching list command" };
  }
  if (failure.code === "conflict" || failure.code === "already_exists" || ALREADY.test(text) || NOT_RUNNING[path]?.test(text)) {
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
