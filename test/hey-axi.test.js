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

test("delegates version and renders the installed release metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hey-axi-"));
  const fakeHey = join(directory, "hey");
  await writeFile(fakeHey, `#!/bin/sh
printf '%s\\n' "$*" > "$HEY_ARGS_FILE"
printf '%s' '{"version":"1.4.0","commit":"abc123","source":"release"}'
`);
  await execFile(process.env.SHELL || "/bin/sh", ["-c", `chmod +x "$1"`, "sh", fakeHey]);
  const argsFile = join(directory, "args");
  const result = await new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", "version"], {
    env: { ...process.env, HEY_BIN: fakeHey, HEY_ARGS_FILE: argsFile },
  }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error, null);
  assert.match(result.stdout, /1\.4\.0/);
  assert.match(result.stdout, /abc123/);
  const forwarded = await import("node:fs/promises").then(({ readFile }) => readFile(argsFile, "utf8"));
  assert.equal(forwarded.trim(), "version --json");
  await rm(directory, { recursive: true, force: true });
});

test("rejects unknown commands with a structured error and exit 2", async () => {
  const result = await new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", "wat"], (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error.code, 2);
  assert.match(result.stdout, /unknown command/);
  assert.equal(result.stderr, "");
});

test("delegates supported triage mutations and preserves their arguments", async () => {
  const cases = [
    ["label", "add", "123", "--to", "789", "label add 123 --to 789 --json"],
    ["seen", "123", "456", "seen 123 456 --json"],
    ["move", "123", "--to", "feed", "move 123 --to feed --json"],
    ["trash", "123", "456", "trash 123 456 --json"],
  ];

  for (const command of cases) {
    const directory = await mkdtemp(join(tmpdir(), "hey-axi-"));
    const fakeHey = join(directory, "hey");
    await writeFile(fakeHey, `#!/bin/sh
printf '%s\\n' "$*" > "$HEY_ARGS_FILE"
printf '%s' '{"ok":true,"data":{"changed":true}}'
`);
    await execFile(process.env.SHELL || "/bin/sh", ["-c", `chmod +x "$1"`, "sh", fakeHey]);
    const argsFile = join(directory, "args");
    const result = await new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", ...command.slice(0, -1)], {
      env: { ...process.env, HEY_BIN: fakeHey, HEY_ARGS_FILE: argsFile },
    }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
    assert.equal(result.error, null, command.join(" "));
    assert.match(result.stdout, /changed/);
    const forwarded = await import("node:fs/promises").then(({ readFile }) => readFile(argsFile, "utf8"));
    assert.equal(forwarded.trim(), command.at(-1), command.join(" "));
    await rm(directory, { recursive: true, force: true });
  }
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
  assert.equal(forwarded.trim(), "box list --limit 5 --json");
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
  assert.equal(forwarded.trim(), "auth status --json");
  await rm(directory, { recursive: true, force: true });
});

test("delegates bundle views and preserves pagination flags", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hey-axi-"));
  const fakeHey = join(directory, "hey");
  await writeFile(fakeHey, `#!/bin/sh
printf '%s\\n' "$*" > "$HEY_ARGS_FILE"
printf '%s' '{"ok":true,"data":[{"id":321,"topic_id":654,"subject":"Grouped message"}]}'
`);
  await execFile(process.env.SHELL || "/bin/sh", ["-c", `chmod +x "$1"`, "sh", fakeHey]);
  const argsFile = join(directory, "args");
  const result = await new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", "bundle", "view", "321", "--page", "cursor-2", "--limit", "5"], {
    env: { ...process.env, HEY_BIN: fakeHey, HEY_ARGS_FILE: argsFile },
  }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error, null);
  assert.match(result.stdout, /Grouped message/);
  const forwarded = await import("node:fs/promises").then(({ readFile }) => readFile(argsFile, "utf8"));
  assert.equal(forwarded.trim(), "bundle view 321 --page cursor-2 --limit 5 --json");
  await rm(directory, { recursive: true, force: true });
});

test("delegates bubble listing and preserves pagination flags", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hey-axi-"));
  const fakeHey = join(directory, "hey");
  await writeFile(fakeHey, `#!/bin/sh
printf '%s\\n' "$*" > "$HEY_ARGS_FILE"
printf '%s' '{"ok":true,"data":{"bubbled_up":[{"id":321,"subject":"Bubbled message"}],"scheduled":[{"id":654,"subject":"Scheduled message"}]}}'
`);
  await execFile(process.env.SHELL || "/bin/sh", ["-c", `chmod +x "$1"`, "sh", fakeHey]);
  const argsFile = join(directory, "args");
  const result = await new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", "bubble", "list", "--limit", "5", "--all"], {
    env: { ...process.env, HEY_BIN: fakeHey, HEY_ARGS_FILE: argsFile },
  }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error, null);
  assert.match(result.stdout, /Bubbled message/);
  assert.match(result.stdout, /Scheduled message/);
  const forwarded = await import("node:fs/promises").then(({ readFile }) => readFile(argsFile, "utf8"));
  assert.equal(forwarded.trim(), "bubble list --limit 5 --all --json");
  await rm(directory, { recursive: true, force: true });
});

test("delegates bulk-reply preview without sending and preserves thread IDs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hey-axi-"));
  const fakeHey = join(directory, "hey");
  await writeFile(fakeHey, `#!/bin/sh
printf '%s\\n' "$*" > "$HEY_ARGS_FILE"
printf '%s' '{"ok":true,"data":[{"box_item_id":321,"topic_id":654,"to":["jane@example.com"],"subject":"Reply preview"}]}'
`);
  await execFile(process.env.SHELL || "/bin/sh", ["-c", `chmod +x "$1"`, "sh", fakeHey]);
  const argsFile = join(directory, "args");
  const result = await new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", "bulk-reply", "preview", "321", "654"], {
    env: { ...process.env, HEY_BIN: fakeHey, HEY_ARGS_FILE: argsFile },
  }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error, null);
  assert.match(result.stdout, /Reply preview/);
  assert.match(result.stdout, /jane@example\.com/);
  const forwarded = await import("node:fs/promises").then(({ readFile }) => readFile(argsFile, "utf8"));
  assert.equal(forwarded.trim(), "bulk-reply preview 321 654 --json");
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
  assert.equal(forwarded.trim(), "thread read 123 --allow-partial --json");
  await rm(directory, { recursive: true, force: true });
});

test("delegates attachment listing and preserves the partial-read safety flag", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hey-axi-"));
  const fakeHey = join(directory, "hey");
  await writeFile(fakeHey, `#!/bin/sh
printf '%s\\n' "$*" > "$HEY_ARGS_FILE"
printf '%s' '{"ok":true,"data":[{"id":987,"filename":"agenda.pdf","content_type":"application/pdf"}]}'
`);
  await execFile(process.env.SHELL || "/bin/sh", ["-c", `chmod +x "$1"`, "sh", fakeHey]);
  const argsFile = join(directory, "args");
  const result = await new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", "attachment", "list", "123", "--allow-partial"], {
    env: { ...process.env, HEY_BIN: fakeHey, HEY_ARGS_FILE: argsFile },
  }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error, null);
  assert.match(result.stdout, /agenda\.pdf/);
  const forwarded = await import("node:fs/promises").then(({ readFile }) => readFile(argsFile, "utf8"));
  assert.equal(forwarded.trim(), "attachment list 123 --allow-partial --json");
  await rm(directory, { recursive: true, force: true });
});

test("delegates clip listing and renders saved passage data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hey-axi-"));
  const fakeHey = join(directory, "hey");
  await writeFile(fakeHey, `#!/bin/sh
printf '%s\\n' "$*" > "$HEY_ARGS_FILE"
printf '%s' '[{"id":250908,"content":"854093","topic":{"id":1464700104,"name":"Passcode for access"}}]'
`);
  await execFile(process.env.SHELL || "/bin/sh", ["-c", `chmod +x "$1"`, "sh", fakeHey]);
  const argsFile = join(directory, "args");
  const result = await new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", "clip", "list"], {
    env: { ...process.env, HEY_BIN: fakeHey, HEY_ARGS_FILE: argsFile },
  }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error, null);
  assert.match(result.stdout, /Passcode for access/);
  assert.match(result.stdout, /854093/);
  const forwarded = await import("node:fs/promises").then(({ readFile }) => readFile(argsFile, "utf8"));
  assert.equal(forwarded.trim(), "clip list --json");
  await rm(directory, { recursive: true, force: true });
});

test("delegates Set Aside listing and preserves pagination flags", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hey-axi-"));
  const fakeHey = join(directory, "hey");
  await writeFile(fakeHey, `#!/bin/sh
printf '%s\\n' "$*" > "$HEY_ARGS_FILE"
printf '%s' '{"ok":true,"data":[{"id":654,"subject":"Review later","group_id":12}]}'
`);
  await execFile(process.env.SHELL || "/bin/sh", ["-c", `chmod +x "$1"`, "sh", fakeHey]);
  const argsFile = join(directory, "args");
  const result = await new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", "set-aside", "view", "--page", "cursor-2", "--all"], {
    env: { ...process.env, HEY_BIN: fakeHey, HEY_ARGS_FILE: argsFile },
  }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error, null);
  assert.match(result.stdout, /Review later/);
  const forwarded = await import("node:fs/promises").then(({ readFile }) => readFile(argsFile, "utf8"));
  assert.equal(forwarded.trim(), "set-aside view --page cursor-2 --all --json");
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
  assert.equal(forwarded.trim(), "search quarterly planning --from jane@example.com --date last_30_days --json");
  await rm(directory, { recursive: true, force: true });
});

test("delegates search filters without altering the upstream command", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hey-axi-"));
  const fakeHey = join(directory, "hey");
  await writeFile(fakeHey, `#!/bin/sh
printf '%s\\n' "$*" > "$HEY_ARGS_FILE"
printf '%s' '{"ok":true,"data":{"from":["jane@example.com"],"date":["today"]}}'
`);
  await execFile(process.env.SHELL || "/bin/sh", ["-c", `chmod +x "$1"`, "sh", fakeHey]);
  const argsFile = join(directory, "args");
  const result = await new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", "search", "filters"], {
    env: { ...process.env, HEY_BIN: fakeHey, HEY_ARGS_FILE: argsFile },
  }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error, null);
  assert.match(result.stdout, /jane@example\.com/);
  const forwarded = await import("node:fs/promises").then(({ readFile }) => readFile(argsFile, "utf8"));
  assert.equal(forwarded.trim(), "search filters --json");
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
  assert.equal(forwarded.trim(), "label view 789 --page cursor-1 --json");
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
  assert.equal(forwarded.trim(), "calendar list --json");
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
  assert.equal(forwarded.trim(), "event list --calendar 42 --starts-on 2026-09-01 --ends-on 2026-09-30 --limit 10 --json");
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
  assert.equal(forwarded.trim(), "todo list --calendar 42 --starts-on 2026-09-01 --ends-on 2026-09-30 --limit 10 --json");
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
  assert.equal(forwarded.trim(), "contact list --page 2 --all --json");
  await rm(directory, { recursive: true, force: true });
});

test("delegates contact threads and preserves pagination flags", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hey-axi-"));
  const fakeHey = join(directory, "hey");
  await writeFile(fakeHey, `#!/bin/sh
printf '%s\\n' "$*" > "$HEY_ARGS_FILE"
printf '%s' '{"ok":true,"data":[{"id":314,"topic_id":2718,"subject":"All contact mail"}]}'
`);
  await execFile(process.env.SHELL || "/bin/sh", ["-c", `chmod +x "$1"`, "sh", fakeHey]);
  const argsFile = join(directory, "args");
  const result = await new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", "contact", "threads", "314", "--page", "cursor-2", "--limit", "5", "--all"], {
    env: { ...process.env, HEY_BIN: fakeHey, HEY_ARGS_FILE: argsFile },
  }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error, null);
  assert.match(result.stdout, /All contact mail/);
  const forwarded = await import("node:fs/promises").then(({ readFile }) => readFile(argsFile, "utf8"));
  assert.equal(forwarded.trim(), "contact threads 314 --page cursor-2 --limit 5 --all --json");
  await rm(directory, { recursive: true, force: true });
});

test("delegates journal listing and preserves calendar/date filters", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hey-axi-"));
  const fakeHey = join(directory, "hey");
  await writeFile(fakeHey, `#!/bin/sh
printf '%s\\n' "$*" > "$HEY_ARGS_FILE"
printf '%s' '{"ok":true,"data":[{"date":"2026-09-03","content":"Today notes"}]}'
`);
  await execFile(process.env.SHELL || "/bin/sh", ["-c", `chmod +x "$1"`, "sh", fakeHey]);
  const argsFile = join(directory, "args");
  const result = await new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", "journal", "list", "--calendar", "42", "--starts-on", "2026-09-01", "--ends-on", "2026-09-30", "--limit", "10", "--all"], {
    env: { ...process.env, HEY_BIN: fakeHey, HEY_ARGS_FILE: argsFile },
  }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error, null);
  assert.match(result.stdout, /Today/);
  const forwarded = await import("node:fs/promises").then(({ readFile }) => readFile(argsFile, "utf8"));
  assert.equal(forwarded.trim(), "journal list --calendar 42 --starts-on 2026-09-01 --ends-on 2026-09-30 --limit 10 --all --json");
  await rm(directory, { recursive: true, force: true });
});

test("delegates journal reads and preserves an optional date", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hey-axi-"));
  const fakeHey = join(directory, "hey");
  await writeFile(fakeHey, `#!/bin/sh
printf '%s\\n' "$*" > "$HEY_ARGS_FILE"
printf '%s' '{"ok":true,"data":{"date":"2026-09-03","content":"Today notes"}}'
`);
  await execFile(process.env.SHELL || "/bin/sh", ["-c", `chmod +x "$1"`, "sh", fakeHey]);
  const argsFile = join(directory, "args");
  const result = await new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", "journal", "read", "2026-09-03"], {
    env: { ...process.env, HEY_BIN: fakeHey, HEY_ARGS_FILE: argsFile },
  }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error, null);
  assert.match(result.stdout, /Today notes/);
  const forwarded = await import("node:fs/promises").then(({ readFile }) => readFile(argsFile, "utf8"));
  assert.equal(forwarded.trim(), "journal read 2026-09-03 --json");
  await rm(directory, { recursive: true, force: true });
});

test("delegates collection listing and preserves pagination flags", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hey-axi-"));
  const fakeHey = join(directory, "hey");
  await writeFile(fakeHey, `#!/bin/sh
printf '%s\\n' "$*" > "$HEY_ARGS_FILE"
printf '%s' '{"ok":true,"data":[{"id":20671,"name":"AWS Bounce"}]}'
`);
  await execFile(process.env.SHELL || "/bin/sh", ["-c", `chmod +x "$1"`, "sh", fakeHey]);
  const argsFile = join(directory, "args");
  const result = await new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", "collection", "list", "--limit", "5", "--all"], {
    env: { ...process.env, HEY_BIN: fakeHey, HEY_ARGS_FILE: argsFile },
  }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error, null);
  assert.match(result.stdout, /AWS Bounce/);
  const forwarded = await import("node:fs/promises").then(({ readFile }) => readFile(argsFile, "utf8"));
  assert.equal(forwarded.trim(), "collection list --limit 5 --all --json");
  await rm(directory, { recursive: true, force: true });
});

test("delegates collection view and preserves the collection id and pagination flags", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hey-axi-"));
  const fakeHey = join(directory, "hey");
  await writeFile(fakeHey, `#!/bin/sh
printf '%s\\n' "$*" > "$HEY_ARGS_FILE"
printf '%s' '{"ok":true,"data":[{"id":812,"topic_id":456,"subject":"Quarterly planning"}]}'
`);
  await execFile(process.env.SHELL || "/bin/sh", ["-c", `chmod +x "$1"`, "sh", fakeHey]);
  const argsFile = join(directory, "args");
  const result = await new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", "collection", "view", "20671", "--page", "cursor-2", "--limit", "5"], {
    env: { ...process.env, HEY_BIN: fakeHey, HEY_ARGS_FILE: argsFile },
  }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error, null);
  assert.match(result.stdout, /Quarterly planning/);
  const forwarded = await import("node:fs/promises").then(({ readFile }) => readFile(argsFile, "utf8"));
  assert.equal(forwarded.trim(), "collection view 20671 --page cursor-2 --limit 5 --json");
  await rm(directory, { recursive: true, force: true });
});

test("delegates workflow listing and preserves pagination flags", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hey-axi-"));
  const fakeHey = join(directory, "hey");
  await writeFile(fakeHey, `#!/bin/sh
printf '%s\\n' "$*" > "$HEY_ARGS_FILE"
printf '%s' '{"ok":true,"data":[{"id":17,"name":"Follow up","account_id":3}]}'
`);
  await execFile(process.env.SHELL || "/bin/sh", ["-c", `chmod +x "$1"`, "sh", fakeHey]);
  const argsFile = join(directory, "args");
  const result = await new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", "workflow", "list", "--limit", "5", "--all"], {
    env: { ...process.env, HEY_BIN: fakeHey, HEY_ARGS_FILE: argsFile },
  }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error, null);
  assert.match(result.stdout, /Follow up/);
  const forwarded = await import("node:fs/promises").then(({ readFile }) => readFile(argsFile, "utf8"));
  assert.equal(forwarded.trim(), "workflow list --limit 5 --all --json");
  await rm(directory, { recursive: true, force: true });
});

test("delegates workflow view and preserves the workflow id", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hey-axi-"));
  const fakeHey = join(directory, "hey");
  await writeFile(fakeHey, `#!/bin/sh
printf '%s\\n' "$*" > "$HEY_ARGS_FILE"
printf '%s' '{"ok":true,"data":{"id":17,"name":"Follow up","stages":[{"id":4,"name":"Waiting"}]}}'
`);
  await execFile(process.env.SHELL || "/bin/sh", ["-c", `chmod +x "$1"`, "sh", fakeHey]);
  const argsFile = join(directory, "args");
  const result = await new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", "workflow", "view", "17"], {
    env: { ...process.env, HEY_BIN: fakeHey, HEY_ARGS_FILE: argsFile },
  }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error, null);
  assert.match(result.stdout, /Waiting/);
  const forwarded = await import("node:fs/promises").then(({ readFile }) => readFile(argsFile, "utf8"));
  assert.equal(forwarded.trim(), "workflow view 17 --json");
  await rm(directory, { recursive: true, force: true });
});

test("delegates snippet listing and renders reusable snippet data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hey-axi-"));
  const fakeHey = join(directory, "hey");
  await writeFile(fakeHey, `#!/bin/sh
printf '%s\\n' "$*" > "$HEY_ARGS_FILE"
printf '%s' '{"ok":true,"data":[{"id":51,"name":"Meeting follow-up","content":"Thanks for meeting."}]}'
`);
  await execFile(process.env.SHELL || "/bin/sh", ["-c", `chmod +x "$1"`, "sh", fakeHey]);
  const argsFile = join(directory, "args");
  const result = await new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", "snippet", "list"], {
    env: { ...process.env, HEY_BIN: fakeHey, HEY_ARGS_FILE: argsFile },
  }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error, null);
  assert.match(result.stdout, /Meeting follow-up/);
  assert.match(result.stdout, /Thanks for meeting/);
  const forwarded = await import("node:fs/promises").then(({ readFile }) => readFile(argsFile, "utf8"));
  assert.equal(forwarded.trim(), "snippet list --json");
  await rm(directory, { recursive: true, force: true });
});

test("delegates draft listing and preserves pagination flags", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hey-axi-"));
  const fakeHey = join(directory, "hey");
  await writeFile(fakeHey, `#!/bin/sh
printf '%s\\n' "$*" > "$HEY_ARGS_FILE"
printf '%s' '{"ok":true,"data":[{"id":812,"subject":"Unsent note","to":"jane@example.com"}]}'
`);
  await execFile(process.env.SHELL || "/bin/sh", ["-c", `chmod +x "$1"`, "sh", fakeHey]);
  const argsFile = join(directory, "args");
  const result = await new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", "draft", "list", "--limit", "5", "--all"], {
    env: { ...process.env, HEY_BIN: fakeHey, HEY_ARGS_FILE: argsFile },
  }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error, null);
  assert.match(result.stdout, /Unsent note/);
  const forwarded = await import("node:fs/promises").then(({ readFile }) => readFile(argsFile, "utf8"));
  assert.equal(forwarded.trim(), "draft list --limit 5 --all --json");
  await rm(directory, { recursive: true, force: true });
});

test("delegates contact show and renders contact details", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hey-axi-"));
  const fakeHey = join(directory, "hey");
  await writeFile(fakeHey, `#!/bin/sh
printf '%s\\n' "$*" > "$HEY_ARGS_FILE"
printf '%s' '{"ok":true,"data":{"id":789,"name":"Jane Example","email":"jane@example.com"}}'
`);
  await execFile(process.env.SHELL || "/bin/sh", ["-c", `chmod +x "$1"`, "sh", fakeHey]);
  const argsFile = join(directory, "args");
  const result = await new Promise((resolve) => execFile(process.execPath, ["src/hey-axi.js", "contact", "show", "789"], {
    env: { ...process.env, HEY_BIN: fakeHey, HEY_ARGS_FILE: argsFile },
  }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(result.error, null);
  assert.match(result.stdout, /Jane Example/);
  assert.match(result.stdout, /jane@example\.com/);
  const forwarded = await import("node:fs/promises").then(({ readFile }) => readFile(argsFile, "utf8"));
  assert.equal(forwarded.trim(), "contact show 789 --json");
  await rm(directory, { recursive: true, force: true });
});
