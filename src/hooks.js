// `hey-axi setup hooks`: register hey-axi in the agent session lifecycle for Claude Code,
// Codex and OpenCode (AXI principle 7). Only this explicit command writes agent config;
// nothing else ever does.
//   - session start: the no-args home view (via axi-sdk-js's hook installer)
//   - session end:   `hey-axi hook session-end`, which folds what hey-axi did this
//                    session into the summary the next home view shows (src/activity.js)
//
//   hey-axi setup hooks              install or repair (user scope: ~/.claude, ~/.codex, ~/.config/opencode)
//   hey-axi setup hooks --project    the same, for the current directory (.claude/, .codex/, .opencode/)
//   hey-axi setup hooks --status     report only, no writes
//   hey-axi setup hooks --remove     remove hey-axi's managed hooks (other hooks are left alone)

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { collapse } from "./home-path.js";
import { disableCapture, enableCapture } from "./activity.js";

const MARKER = "hey-axi";
export const HOOK_FLAGS = ["--project", "--status", "--remove", "--help", "-h"];
const END_ARGS = "hook session-end";
const END_PLUGIN_MARKER = "hey-axi managed opencode session-end plugin";

export const HOOKS_HELP = [
  "hey-axi setup hooks — show the hey-axi home view at the start of every agent session, and remember what each session did",
  "",
  "usage: hey-axi setup hooks [--project] [--status | --remove]",
  "",
  "flags:",
  "  --project   target this directory (.claude/settings.json, .codex/hooks.json, .opencode/plugins/) instead of your user config (default: user config)",
  "  --status    report what is installed; writes nothing (default false)",
  "  --remove    remove hey-axi's managed hooks and its session journal; other hooks are left alone (default false: install or repair)",
  "",
  "agents: Claude Code (SessionStart + SessionEnd hooks), Codex (SessionStart + SessionEnd hooks; also sets [features].hooks = true in ~/.codex/config.toml), OpenCode (managed plugins)",
  "Session end: hey-axi keeps a local journal of what it did (command names and numeric ids only) and the next session's home view summarizes it (e.g. drafts waiting to be reviewed).",
  "Re-running is a no-op when nothing changed, and repairs the command path after hey-axi moves.",
  "Note: the start hook puts subjects and senders from the directory's scope into every session's context. `hey-axi setup scope` narrows it; --project limits it to one directory.",
  "",
  "examples:",
  "  hey-axi setup hooks",
  "  hey-axi setup hooks --project",
  "  hey-axi setup hooks --status",
].join("\n");

function snapshot(paths) {
  return paths.map((path) => (existsSync(path) ? readFileSync(path, "utf8") : null));
}

function readJson(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
}

const isMine = (hook) => typeof hook?.command === "string" && hook.command.includes(MARKER) && hook.command.endsWith(END_ARGS);

function endTargets(scope, root, home) {
  return {
    claude: join(root, ".claude", "settings.json"),
    codex: join(root, ".codex", "hooks.json"),
    opencode: join(scope === "project" ? join(root, ".opencode", "plugins") : join(home, ".config", "opencode", "plugins"), "axi-hey-axi-session-end.js"),
  };
}

// The command the start hook runs (portable name or absolute path, chosen by axi-sdk-js).
function startCommand(paths) {
  for (const path of paths) {
    try {
      for (const group of readJson(path).hooks?.SessionStart || []) {
        for (const hook of group.hooks || []) if (typeof hook.command === "string" && hook.command.includes(MARKER)) return hook.command;
      }
    } catch {
      // unreadable config: try the next one
    }
  }
  return null;
}

function setEndHook(path, command, onError) {
  try {
    const settings = readJson(path);
    settings.hooks ||= {};
    const groups = Array.isArray(settings.hooks.SessionEnd) ? settings.hooks.SessionEnd : [];
    const wanted = { type: "command", command, timeout: 5 };
    let found = false;
    for (const group of groups) {
      for (const hook of group.hooks || []) {
        if (!isMine(hook)) continue;
        found = true;
        Object.assign(hook, wanted);
      }
    }
    if (!found) groups.push({ hooks: [wanted] });
    settings.hooks.SessionEnd = groups;
    const next = `${JSON.stringify(settings, null, 2)}\n`;
    if (!existsSync(path) || readFileSync(path, "utf8") !== next) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, next);
    }
  } catch (error) {
    onError(`${path}: ${error.message}`);
  }
}

function removeEndHook(path, onError) {
  try {
    if (!existsSync(path)) return;
    const settings = readJson(path);
    const groups = settings.hooks?.SessionEnd;
    if (!Array.isArray(groups)) return;
    const kept = groups.map((group) => ({ ...group, hooks: (group.hooks || []).filter((hook) => !isMine(hook)) })).filter((group) => group.hooks.length);
    if (kept.length === groups.length && kept.every((group, index) => group.hooks.length === groups[index].hooks.length)) return;
    if (kept.length) settings.hooks.SessionEnd = kept;
    else delete settings.hooks.SessionEnd;
    writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
  } catch (error) {
    onError(`${path}: ${error.message}`);
  }
}

function hasEndHook(path) {
  try {
    return (readJson(path).hooks?.SessionEnd || []).some((group) => (group.hooks || []).some(isMine));
  } catch {
    return false;
  }
}

function openCodeEndPlugin(command) {
  return `// ${END_PLUGIN_MARKER}
// Generated by \`hey-axi setup hooks\`. \`hey-axi setup hooks --remove\` deletes it.
import { spawn } from "node:child_process";

const command = ${JSON.stringify(command)};

function capture(directory, sessionID) {
  return new Promise((resolve) => {
    const child = spawn(command, ["hook", "session-end"], { cwd: directory || process.cwd(), shell: false, stdio: ["pipe", "ignore", "ignore"] });
    const timer = setTimeout(() => child.kill("SIGTERM"), 5000);
    child.on("error", () => { clearTimeout(timer); resolve(); });
    child.on("close", () => { clearTimeout(timer); resolve(); });
    child.stdin.end(JSON.stringify({ session_id: sessionID, cwd: directory }));
  });
}

export const HeyAxiSessionEndPlugin = async ({ directory }) => ({
  event: async ({ event }) => {
    const idle = event.type === "session.idle" || (event.type === "session.status" && event.properties?.status?.type === "idle");
    if (idle || event.type === "session.deleted") await capture(directory, event.properties?.sessionID ?? event.properties?.info?.id);
  },
});
`;
}

function setEndPlugin(path, command, onError) {
  try {
    const next = openCodeEndPlugin(command);
    if (existsSync(path)) {
      const current = readFileSync(path, "utf8");
      if (!current.includes(END_PLUGIN_MARKER)) return onError(`${path}: refusing to overwrite an unmanaged OpenCode plugin`);
      if (current === next) return;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, next);
  } catch (error) {
    onError(`${path}: ${error.message}`);
  }
}

function removeEndPlugin(path, onError) {
  try {
    if (existsSync(path) && readFileSync(path, "utf8").includes(END_PLUGIN_MARKER)) rmSync(path);
  } catch (error) {
    onError(`${path}: ${error.message}`);
  }
}

function describe(status, end) {
  const state = (start, finish) => (start ? `installed ${finish ? "with" : "without"} session end` : finish ? "not installed (session end only)" : "not installed");
  return {
    claude: `${state(status.claude.installed, hasEndHook(end.claude))} (${collapse(status.claude.path)})`,
    codex: `${state(status.codex.installed, hasEndHook(end.codex))} (${collapse(status.codex.path)}; hooks feature ${status.codex.userFeatureEnabled ? "on" : "off"} in ${collapse(status.codex.userFeaturePath)})`,
    opencode: `${state(status.opencode.installed, existsSync(end.opencode))} (${collapse(status.opencode.path)})`,
  };
}

// Returns { output, code }.
export async function setupHooks(flags, { execPath = process.argv[1], cwd = process.cwd(), home = homedir() } = {}) {
  const unknown = [...flags].filter((flag) => !HOOK_FLAGS.includes(flag));
  if (unknown.length) {
    return { code: 2, output: { ok: false, error: `unknown flag ${unknown.join(", ")} for \`setup hooks\``, help: "valid flags for `setup hooks`: --project, --status, --remove" } };
  }
  if (flags.has("--status") && flags.has("--remove")) {
    return { code: 2, output: { ok: false, error: "--status and --remove can't be combined", help: "Run `hey-axi setup hooks --status` or `hey-axi setup hooks --remove`" } };
  }
  const sdk = await import("axi-sdk-js");
  const scope = flags.has("--project") ? "project" : "user";
  const root = scope === "project" ? resolve(cwd) : home;
  const options = { marker: MARKER, scope, projectDir: cwd, homeDir: home };
  const end = endTargets(scope, root, home);
  const before = sdk.sessionStartHookStatus(options);
  const files = [before.claude.path, before.codex.path, before.codex.userFeaturePath, before.opencode.path, end.opencode];
  const errors = [];
  const onError = (message) => errors.push(message);

  if (flags.has("--status")) {
    return { code: 0, output: { hooks: `status (${scope} scope)`, ...describe(before, end) } };
  }

  const was = snapshot(files);
  let captureChanged = false;
  if (flags.has("--remove")) {
    sdk.uninstallSessionStartHooks({ ...options, onError });
    removeEndHook(end.claude, onError);
    removeEndHook(end.codex, onError);
    removeEndPlugin(end.opencode, onError);
    const otherScope = sdk.sessionStartHookStatus({ ...options, scope: scope === "project" ? "user" : "project" });
    if (!otherScope.claude.installed && !otherScope.codex.installed && !otherScope.opencode.installed) captureChanged = disableCapture();
  } else {
    sdk.installSessionStartHooks({
      ...options,
      execPath,
      binaryNames: [MARKER],
      distEntrypoints: ["src/hey-axi.js"],
      onError,
    });
    const command = startCommand([before.claude.path, before.codex.path]);
    if (command) {
      // Claude Code and Codex run hook commands through a shell: quote a path with spaces.
      const shellCommand = /\s/.test(command) && existsSync(command) ? `'${command.replace(/'/g, "'\\''")}'` : command;
      setEndHook(end.claude, `${shellCommand} ${END_ARGS}`, onError);
      setEndHook(end.codex, `${shellCommand} ${END_ARGS}`, onError);
      setEndPlugin(end.opencode, command, onError);
      captureChanged = enableCapture();
    }
  }
  const after = sdk.sessionStartHookStatus(options);
  const changed = captureChanged || snapshot(files).some((content, index) => content !== was[index]);
  const verb = flags.has("--remove") ? (changed ? "removed" : "nothing to remove (no-op)") : changed ? "installed or updated" : "already up to date (no changes)";
  const output = { hooks: `${verb} (${scope} scope)`, ...describe(after, end) };
  if (!flags.has("--remove") && !after.claude.installed && !after.codex.installed && !after.opencode.installed) {
    output.ok = false;
    output.error = "no hook was installed";
  }
  if (errors.length) output.errors = errors;
  if (!flags.has("--remove")) output.help = ["Start a new agent session to see the home view", "Run `hey-axi setup scope --label <name>` to focus this directory", "Run `hey-axi setup hooks --remove` to undo"];
  return { code: errors.length || output.ok === false ? 1 : 0, output };
}
