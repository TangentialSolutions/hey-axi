// `hey-axi setup hooks`: register the no-args home view as session-start context for
// Claude Code, Codex and OpenCode (AXI principle 7), using axi-sdk-js's hook installer.
// Only this explicit command writes agent config; nothing else ever does.
//
//   hey-axi setup hooks              install or repair (user scope: ~/.claude, ~/.codex, ~/.config/opencode)
//   hey-axi setup hooks --project    the same, for the current directory (.claude/, .codex/, .opencode/)
//   hey-axi setup hooks --status     report only, no writes
//   hey-axi setup hooks --remove     remove hey-axi's managed hooks (other hooks are left alone)

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { collapse } from "./home.js";

const MARKER = "hey-axi";
export const HOOK_FLAGS = ["--project", "--status", "--remove", "--help", "-h"];

export const HOOKS_HELP = [
  "hey-axi setup hooks — show the hey-axi home view (Imbox summary + next commands) at the start of every agent session",
  "",
  "usage: hey-axi setup hooks [--project] [--status | --remove]",
  "",
  "flags:",
  "  --project   target this directory (.claude/settings.json, .codex/hooks.json, .opencode/plugins/) instead of your user config",
  "  --status    report what is installed; writes nothing",
  "  --remove    remove hey-axi's managed hooks; other hooks are left alone",
  "",
  "agents: Claude Code (SessionStart hook), Codex (SessionStart hook; also sets [features].hooks = true in ~/.codex/config.toml), OpenCode (managed plugin)",
  "Re-running is a no-op when nothing changed, and repairs the command path after hey-axi moves.",
  "Note: the hook puts Imbox senders and subjects into every session's context. Use --project to limit it to one directory.",
  "",
  "examples:",
  "  hey-axi setup hooks",
  "  hey-axi setup hooks --project",
  "  hey-axi setup hooks --status",
].join("\n");

function snapshot(paths) {
  return paths.map((path) => (existsSync(path) ? readFileSync(path, "utf8") : null));
}

function describe(status) {
  return {
    claude: `${status.claude.installed ? "installed" : "not installed"} (${collapse(status.claude.path)})`,
    codex: `${status.codex.installed ? "installed" : "not installed"} (${collapse(status.codex.path)}; hooks feature ${status.codex.userFeatureEnabled ? "on" : "off"} in ${collapse(status.codex.userFeaturePath)})`,
    opencode: `${status.opencode.installed ? "installed" : "not installed"} (${collapse(status.opencode.path)})`,
  };
}

// Returns { output, code }.
export async function setupHooks(flags, { execPath = process.argv[1] } = {}) {
  const unknown = [...flags].filter((flag) => !HOOK_FLAGS.includes(flag));
  if (unknown.length) {
    return { code: 2, output: { ok: false, error: `unknown flag ${unknown.join(", ")} for \`setup hooks\``, help: "valid flags for `setup hooks`: --project, --status, --remove" } };
  }
  if (flags.has("--status") && flags.has("--remove")) {
    return { code: 2, output: { ok: false, error: "--status and --remove can't be combined", help: "Run `hey-axi setup hooks --status` or `hey-axi setup hooks --remove`" } };
  }
  const sdk = await import("axi-sdk-js");
  const scope = flags.has("--project") ? "project" : "user";
  const options = { marker: MARKER, scope, projectDir: process.cwd(), homeDir: homedir() };
  const before = sdk.sessionStartHookStatus(options);
  const files = [before.claude.path, before.codex.path, before.codex.userFeaturePath, before.opencode.path];
  const errors = [];
  const onError = (message) => errors.push(message);

  if (flags.has("--status")) {
    return { code: 0, output: { hooks: `status (${scope} scope)`, ...describe(before) } };
  }

  const was = snapshot(files);
  if (flags.has("--remove")) {
    sdk.uninstallSessionStartHooks({ ...options, onError });
  } else {
    sdk.installSessionStartHooks({
      ...options,
      execPath,
      binaryNames: [MARKER],
      distEntrypoints: ["src/hey-axi.js"],
      onError,
    });
  }
  const after = sdk.sessionStartHookStatus(options);
  const changed = snapshot(files).some((content, index) => content !== was[index]);
  const verb = flags.has("--remove") ? (changed ? "removed" : "nothing to remove") : changed ? "installed or updated" : "already up to date (no changes)";
  const output = { hooks: `${verb} (${scope} scope)`, ...describe(after) };
  if (!flags.has("--remove") && !after.claude.installed && !after.codex.installed && !after.opencode.installed) {
    output.ok = false;
    output.error = "no hook was installed";
  }
  if (errors.length) output.errors = errors;
  if (!flags.has("--remove")) output.help = ["Start a new agent session to see the home view", "Run `hey-axi setup hooks --remove` to undo"];
  return { code: errors.length || output.ok === false ? 1 : 0, output };
}
