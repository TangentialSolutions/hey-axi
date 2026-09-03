#!/usr/bin/env node

import { spawn } from "node:child_process";
import { encode } from "@toon-format/toon";

const HEY = process.env.HEY_BIN || "/Users/trevorbroaddus/.local/bin/hey";

function usage() {
  return [
    "hey-axi — token-efficient HEY CLI interface",
    "",
    "commands:",
    "  account list          List linked HEY accounts",
    "  auth status           Check HEY authentication status",
    "  box list              List HEY mailboxes",
    "  box view <name|id>    List threads in a mailbox",
    "  label list            List email labels",
    "  label view <id>       List threads with a label",
    "  collection list       List email collections",
    "  workflow list         List email workflows",
    "  calendar list         List calendars",
    "  event list             List calendar events",
    "  todo list              List todos",
    "  contact list           List contacts",
    "  search [query]        Search email threads and messages",
    "  thread read <id>      Read an email thread",
    "  commands              Show the upstream HEY command catalog",
    "",
    "flags:",
    "  --json                Preserve the upstream JSON envelope",
    "  --help                Show this help",
  ].join("\n");
}

function output(value) {
  process.stdout.write(`${encode(value)}\n`);
}

function runHey(args) {
  return new Promise((resolve) => {
    const child = spawn(HEY, [...args, "--json", "--quiet"], { stdio: ["inherit", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => resolve({ status: 1, error: error.message }));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  process.stdout.write(`${usage()}\n`);
  process.exit(0);
}

const json = args.includes("--json");
const command = args.filter((arg) => arg !== "--json");
const commandName = command.filter((arg) => !arg.startsWith("--")).slice(0, 2).join(" ");
let result;

if (commandName === "account list") {
  result = await runHey(["account", "list"]);
} else if (commandName === "auth status") {
  result = await runHey(["auth", "status"]);
} else if (commandName === "box list") {
  result = await runHey(command);
} else if (commandName === "box view") {
  result = await runHey(command);
} else if (commandName === "label list") {
  result = await runHey(command);
} else if (commandName === "label view") {
  result = await runHey(command);
} else if (commandName === "collection list") {
  result = await runHey(command);
} else if (commandName === "workflow list") {
  result = await runHey(command);
} else if (commandName === "calendar list") {
  result = await runHey(command);
} else if (commandName === "event list") {
  result = await runHey(command);
} else if (commandName === "todo list") {
  result = await runHey(command);
} else if (commandName === "contact list") {
  result = await runHey(command);
} else if (command[0] === "search") {
  result = await runHey(command);
} else if (commandName === "thread read") {
  result = await runHey(command);
} else if (commandName === "commands") {
  result = await runHey(["commands"]);
} else {
  output({ ok: false, error: "unknown command", usage: "Run hey-axi --help" });
  process.exit(2);
}

if (result.status !== 0) {
  output({ ok: false, error: result.error || result.stdout.trim() || result.stderr.trim() || "hey command failed", exit_code: result.status });
  process.exit(1);
}

try {
  const parsed = JSON.parse(result.stdout);
  if (json) process.stdout.write(`${JSON.stringify(parsed)}\n`);
  else output(parsed);
} catch (error) {
  output({ ok: false, error: "HEY returned invalid JSON", detail: error.message });
  process.exit(1);
}
