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

// Returns null when the command may run, or a structured refusal.
export function checkPolicy(path, flags, env = process.env) {
  const blocked = blockedReason(path);
  if (blocked) return { error: "unsupported command", command: path, reason: blocked };

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
