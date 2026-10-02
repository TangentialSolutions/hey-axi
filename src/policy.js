// Commands hey-axi resolves but deliberately refuses to run (yet), by category.
// Each needs handling the plain "run with --json and render TOON" path can't give it.

const BLOCKED = new Map([
  // Delivers email. Refused until hey-axi has an explicit send opt-in.
  ...["compose", "reply", "forward", "draft send", "bulk-reply send"].map((path) => [path, "sends email; hey-axi needs an explicit send opt-in for it"]),
  // Prints a credential into the agent's context.
  ["auth token", "prints an access token"],
  // Interactive: needs a terminal, a browser, or a long-lived stdio session.
  ...["tui", "mcp", "auth login", "login", "setup", "setup agents", "setup claude", "setup codex", "setup omarchy", "upgrade"]
    .map((path) => [path, "interactive; run `hey " + path + "` directly"]),
  // Long-running NDJSON stream; buffering until exit would never print anything.
  ["watch", "long-running stream; run `hey watch` directly"],
  // Prints a raw shell script, not JSON.
  ["shell-completion generate", "prints a raw script, not JSON; run `hey shell-completion generate` directly"],
]);

export function blockedReason(path) {
  return BLOCKED.get(path) || null;
}

export function blockedPaths() {
  return [...BLOCKED.keys()];
}
