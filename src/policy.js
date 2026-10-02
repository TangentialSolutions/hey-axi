// What hey-axi will and won't run, beyond "is it a HEY command".

// hey-axi's own flags. Stripped before anything is forwarded to HEY.
export const AXI_FLAGS = ["--allow-send", "--allow-secret"];

// Commands that deliver email. Each lists the HEY flags that make it safe (nothing is sent).
const SEND_COMMANDS = new Map([
  ["compose", ["--draft"]],
  ["reply", ["--draft", "--dry-run"]],
  ["forward", []],
  ["draft send", []],
  ["bulk-reply send", []],
]);

// Commands that print a credential into the agent's context.
const SECRET_COMMANDS = new Set(["auth token"]);

// How a command runs. Anything not listed is "json": captured, parsed, rendered as TOON.
//   interactive: HEY gets the terminal (inherited stdio); nothing is injected or parsed
//   stream:      long-running NDJSON, relayed line by line as it arrives
//   raw:         prints non-JSON (a script, a CSV); relayed untouched
const INTERACTIVE = new Set(["tui", "mcp", "auth login", "login", "setup", "setup agents", "setup claude", "setup codex", "setup omarchy", "upgrade"]);
// Interactive commands that can't do anything useful without a terminal.
const NEEDS_TTY = new Set(["tui"]);
const STREAM = new Set(["watch"]);
const RAW = new Set(["shell-completion generate"]);

export function runMode(path, flags) {
  if (INTERACTIVE.has(path)) return "interactive";
  if (STREAM.has(path)) return "stream";
  if (RAW.has(path)) return "raw";
  // CSV goes to stdout unless --output names a file (then HEY answers with JSON).
  if (path === "timetrack export" && !flags.has("--output") && !flags.has("-o")) return "raw";
  return "json";
}

export function interactivePaths() {
  return [...INTERACTIVE];
}

const truthy = (value) => ["1", "true", "yes"].includes(String(value || "").toLowerCase());

export function sendCommands() {
  return [...SEND_COMMANDS.keys()];
}

// Returns null when the command may run, or a structured refusal.
export function checkPolicy(path, flags, env = process.env, io = { stdin: process.stdin.isTTY, stdout: process.stdout.isTTY }) {
  if (NEEDS_TTY.has(path) && !(io.stdin && io.stdout)) {
    return { error: "needs a terminal", command: path, reason: "interactive full-screen UI", hint: `run \`hey ${path}\` in a terminal` };
  }

  if (SEND_COMMANDS.has(path)) {
    const safe = SEND_COMMANDS.get(path);
    const staged = safe.some((flag) => flags.has(flag));
    const allowed = flags.has("--allow-send") || truthy(env.HEY_AXI_ALLOW_SEND);
    if (!staged && !allowed) {
      const stage = safe.length ? `add ${safe.join(" or ")} to stage it without sending, or ` : "";
      return {
        error: "send blocked",
        command: path,
        reason: "this command delivers email",
        hint: `${stage}pass --allow-send (or set HEY_AXI_ALLOW_SEND=1) to really send`,
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
