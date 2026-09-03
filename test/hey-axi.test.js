import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("shows concise help without invoking HEY", async () => {
  const result = await new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", "--help"], (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error, null);
  assert.match(result.stdout, /account list/);
  assert.equal(result.stderr, "");
});

test("rejects unknown commands with a structured error and exit 2", async () => {
  const result = await new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", "wat"], (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error.code, 2);
  assert.match(result.stdout, /unknown command/);
  assert.equal(result.stderr, "");
});

test("delegates read-only box commands and renders the JSON envelope as TOON", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hey-axi-"));
  const fakeHey = join(directory, "hey");
  await writeFile(fakeHey, `#!/bin/sh
printf '%s\n' "$*" > "$HEY_ARGS_FILE"
printf '%s' '{"ok":true,"data":[{"id":123,"name":"Imbox"}]}'
`);
  await execFile(process.env.SHELL || "/bin/sh", ["-c", `chmod +x "$1"`, "sh", fakeHey]);
  const argsFile = join(directory, "args");
  const result = await new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", "box", "list", "--limit", "5"], {
    env: { ...process.env, HEY_BIN: fakeHey, HEY_ARGS_FILE: argsFile },
  }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error, null);
  assert.match(result.stdout, /data\[1\]\{id,name\}/);
  assert.match(result.stdout, /123,Imbox/);
  const forwarded = await import("node:fs/promises").then(({ readFile }) => readFile(argsFile, "utf8"));
  assert.equal(forwarded.trim(), "box list --limit 5 --json --quiet");
  await rm(directory, { recursive: true, force: true });
});

test("delegates auth status without exposing credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hey-axi-"));
  const fakeHey = join(directory, "hey");
  await writeFile(fakeHey, `#!/bin/sh
printf '%s\n' "$*" > "$HEY_ARGS_FILE"
printf '%s' '{"authenticated":true,"expires_at":"2030-01-01T00:00:00Z"}'
`);
  await execFile(process.env.SHELL || "/bin/sh", ["-c", `chmod +x "$1"`, "sh", fakeHey]);
  const argsFile = join(directory, "args");
  const result = await new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", "auth", "status"], {
    env: { ...process.env, HEY_BIN: fakeHey, HEY_ARGS_FILE: argsFile },
  }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error, null);
  assert.match(result.stdout, /authenticated/);
  assert.match(result.stdout, /2030-01-01/);
  assert.doesNotMatch(result.stdout, /token|secret|cookie/i);
  const forwarded = await import("node:fs/promises").then(({ readFile }) => readFile(argsFile, "utf8"));
  assert.equal(forwarded.trim(), "auth status --json --quiet");
  await rm(directory, { recursive: true, force: true });
});

test("delegates thread read and preserves the partial-read safety flag", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hey-axi-"));
  const fakeHey = join(directory, "hey");
  await writeFile(fakeHey, `#!/bin/sh
printf '%s\\n' "$*" > "$HEY_ARGS_FILE"
printf '%s' '{"ok":true,"data":{"id":123,"subject":"Hello"}}'
`);
  await execFile(process.env.SHELL || "/bin/sh", ["-c", `chmod +x "$1"`, "sh", fakeHey]);
  const argsFile = join(directory, "args");
  const result = await new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", "thread", "read", "123", "--allow-partial"], {
    env: { ...process.env, HEY_BIN: fakeHey, HEY_ARGS_FILE: argsFile },
  }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error, null);
  assert.match(result.stdout, /subject/);
  const forwarded = await import("node:fs/promises").then(({ readFile }) => readFile(argsFile, "utf8"));
  assert.equal(forwarded.trim(), "thread read 123 --allow-partial --json --quiet");
  await rm(directory, { recursive: true, force: true });
});

test("delegates search queries and refinements without altering arguments", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hey-axi-"));
  const fakeHey = join(directory, "hey");
  await writeFile(fakeHey, `#!/bin/sh
printf '%s\\n' "$*" > "$HEY_ARGS_FILE"
printf '%s' '{"ok":true,"data":[{"id":456,"subject":"Quarterly planning"}]}'
`);
  await execFile(process.env.SHELL || "/bin/sh", ["-c", `chmod +x "$1"`, "sh", fakeHey]);
  const argsFile = join(directory, "args");
  const result = await new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", "search", "quarterly planning", "--from", "jane@example.com", "--date", "last_30_days"], {
    env: { ...process.env, HEY_BIN: fakeHey, HEY_ARGS_FILE: argsFile },
  }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error, null);
  assert.match(result.stdout, /Quarterly planning/);
  const forwarded = await import("node:fs/promises").then(({ readFile }) => readFile(argsFile, "utf8"));
  assert.equal(forwarded.trim(), "search quarterly planning --from jane@example.com --date last_30_days --json --quiet");
  await rm(directory, { recursive: true, force: true });
});

test("delegates label view and preserves pagination flags", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hey-axi-"));
  const fakeHey = join(directory, "hey");
  await writeFile(fakeHey, `#!/bin/sh
printf '%s\\n' "$*" > "$HEY_ARGS_FILE"
printf '%s' '{"ok":true,"data":{"labels":[{"id":789,"name":"Travel"}],"next_page":"cursor-2"}}'
`);
  await execFile(process.env.SHELL || "/bin/sh", ["-c", `chmod +x "$1"`, "sh", fakeHey]);
  const argsFile = join(directory, "args");
  const result = await new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", "label", "view", "789", "--page", "cursor-1"], {
    env: { ...process.env, HEY_BIN: fakeHey, HEY_ARGS_FILE: argsFile },
  }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error, null);
  assert.match(result.stdout, /Travel/);
  const forwarded = await import("node:fs/promises").then(({ readFile }) => readFile(argsFile, "utf8"));
  assert.equal(forwarded.trim(), "label view 789 --page cursor-1 --json --quiet");
  await rm(directory, { recursive: true, force: true });
});

test("delegates calendar listing without changing the upstream command", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hey-axi-"));
  const fakeHey = join(directory, "hey");
  await writeFile(fakeHey, `#!/bin/sh
printf '%s\\n' "$*" > "$HEY_ARGS_FILE"
printf '%s' '{"ok":true,"data":[{"id":42,"name":"Personal"}]}'
`);
  await execFile(process.env.SHELL || "/bin/sh", ["-c", `chmod +x "$1"`, "sh", fakeHey]);
  const argsFile = join(directory, "args");
  const result = await new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", "calendar", "list"], {
    env: { ...process.env, HEY_BIN: fakeHey, HEY_ARGS_FILE: argsFile },
  }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error, null);
  assert.match(result.stdout, /Personal/);
  const forwarded = await import("node:fs/promises").then(({ readFile }) => readFile(argsFile, "utf8"));
  assert.equal(forwarded.trim(), "calendar list --json --quiet");
  await rm(directory, { recursive: true, force: true });
});

test("delegates event listing and preserves calendar/date filters", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hey-axi-"));
  const fakeHey = join(directory, "hey");
  await writeFile(fakeHey, `#!/bin/sh
printf '%s\\n' "$*" > "$HEY_ARGS_FILE"
printf '%s' '{"ok":true,"data":[{"id":314,"title":"Planning","starts_on":"2026-09-03"}]}'
`);
  await execFile(process.env.SHELL || "/bin/sh", ["-c", `chmod +x "$1"`, "sh", fakeHey]);
  const argsFile = join(directory, "args");
  const result = await new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", "event", "list", "--calendar", "42", "--starts-on", "2026-09-01", "--ends-on", "2026-09-30", "--limit", "10"], {
    env: { ...process.env, HEY_BIN: fakeHey, HEY_ARGS_FILE: argsFile },
  }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error, null);
  assert.match(result.stdout, /Planning/);
  const forwarded = await import("node:fs/promises").then(({ readFile }) => readFile(argsFile, "utf8"));
  assert.equal(forwarded.trim(), "event list --calendar 42 --starts-on 2026-09-01 --ends-on 2026-09-30 --limit 10 --json --quiet");
  await rm(directory, { recursive: true, force: true });
});

test("delegates todo listing and preserves calendar/date filters", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hey-axi-"));
  const fakeHey = join(directory, "hey");
  await writeFile(fakeHey, `#!/bin/sh
printf '%s\\n' "$*" > "$HEY_ARGS_FILE"
printf '%s' '{"ok":true,"data":[{"id":2718,"title":"Review inbox","due_on":"2026-09-05"}]}'
`);
  await execFile(process.env.SHELL || "/bin/sh", ["-c", `chmod +x "$1"`, "sh", fakeHey]);
  const argsFile = join(directory, "args");
  const result = await new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", "todo", "list", "--calendar", "42", "--starts-on", "2026-09-01", "--ends-on", "2026-09-30", "--limit", "10"], {
    env: { ...process.env, HEY_BIN: fakeHey, HEY_ARGS_FILE: argsFile },
  }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error, null);
  assert.match(result.stdout, /Review inbox/);
  const forwarded = await import("node:fs/promises").then(({ readFile }) => readFile(argsFile, "utf8"));
  assert.equal(forwarded.trim(), "todo list --calendar 42 --starts-on 2026-09-01 --ends-on 2026-09-30 --limit 10 --json --quiet");
  await rm(directory, { recursive: true, force: true });
});

test("delegates contact listing and preserves pagination flags", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hey-axi-"));
  const fakeHey = join(directory, "hey");
  await writeFile(fakeHey, `#!/bin/sh
printf '%s\\n' "$*" > "$HEY_ARGS_FILE"
printf '%s' '{"ok":true,"data":[{"id":314,"name":"Jane Doe","email":"jane@example.com"}]}'
`);
  await execFile(process.env.SHELL || "/bin/sh", ["-c", `chmod +x "$1"`, "sh", fakeHey]);
  const argsFile = join(directory, "args");
  const result = await new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", "contact", "list", "--page", "2", "--all"], {
    env: { ...process.env, HEY_BIN: fakeHey, HEY_ARGS_FILE: argsFile },
  }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error, null);
  assert.match(result.stdout, /Jane Doe/);
  const forwarded = await import("node:fs/promises").then(({ readFile }) => readFile(argsFile, "utf8"));
  assert.equal(forwarded.trim(), "contact list --page 2 --all --json --quiet");
  await rm(directory, { recursive: true, force: true });
});
