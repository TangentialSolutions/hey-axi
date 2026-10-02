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

const BLOCKED = new Map([
  // Interactive: needs a terminal, a browser, or a long-lived stdio session.
  ...["tui", "mcp", "auth login", "login", "setup", "setup agents", "setup claude", "setup codex", "setup omarchy", "upgrade"]
    .map((path) => [path, "interactive; run `hey " + path + "` directly"]),
  // Long-running NDJSON stream; buffering until exit would never print anything.
  ["watch", "long-running stream; run `hey watch` directly"],
  // Prints a raw shell script, not JSON.
  ["shell-completion generate", "prints a raw script, not JSON; run `hey shell-completion generate` directly"],
]);

const truthy = (value) => ["1", "true", "yes"].includes(String(value || "").toLowerCase());

export function blockedReason(path) {
  return BLOCKED.get(path) || null;
}

export function blockedPaths() {
  return [...BLOCKED.keys()];
}

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
export function checkPolicy(path, flags, env = process.env) {
  const blocked = blockedReason(path);
  if (blocked) return { error: "unsupported command", command: path, reason: blocked };

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
