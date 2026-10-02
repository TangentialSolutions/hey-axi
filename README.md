# hey-axi

An agent-friendly wrapper for [HEY CLI](https://github.com/basecamp/hey-cli) (`hey`), Basecamp's command line for HEY email, calendars, todos, habits, time tracking and journals.

hey-axi runs `hey`, asks for its JSON response envelope, and prints it as [TOON](https://github.com/toon-format/toon). It follows the [AXI](https://axi.md) principles: a live home view, minimal default fields, truncated long text, definitive empty states, and unknown flags rejected up front. On our synthetic benchmark that's **~89% fewer tokens than `hey --json`** ([docs/benchmarks.md](docs/benchmarks.md)). It also adds a few safety rails. It covers **every command in HEY CLI v1.7.0** (154 runnable command paths, including the `login`/`logout` aliases, plus the `box <id>`-style shortcuts) by routing from a snapshot of HEY's own `hey commands --json` catalog. See [CHANGELOG.md](CHANGELOG.md) for what changed in each release.

## Install

Requirements: Node 20+ and an authenticated HEY CLI (`curl -fsSL https://hey.com/install-cli | bash`, then `hey auth login`).

```bash
npm i -g hey-axi    # puts `hey-axi` on your PATH
# or run it without installing:
npx -y hey-axi box view imbox

# agent skill (see "Agent integrations" below)
npx skills add TangentialSolutions/hey-axi
```

From source: `git clone https://github.com/TangentialSolutions/hey-axi && cd hey-axi && npm ci && npm link`.

hey-axi uses `$HEY_BIN` if it's set, and otherwise finds `hey` on `PATH`. launchd/cron jobs usually have a minimal PATH, so set `HEY_BIN=$HOME/.local/bin/hey` there.

## Usage

```bash
hey-axi                                    # home view: scope, last session, Imbox count + 10 threads, next commands
hey-axi box view imbox                     # TOON: summary, a few columns per thread, notice, help
hey-axi box imbox                          # HEY's shortcut forms work too
hey-axi --account 2 search --from a@b.com  # global flags anywhere
hey-axi thread read 123                    # bodies cut at 1000 chars with "(truncated, N chars total)"
hey-axi thread read 123 --full             # HEY's complete, untouched result
hey-axi box view imbox --fields id,subject,creator.email_address   # choose columns (--fields all = every field)
hey-axi thread read 123 --json             # the same shaped output as compact JSON
hey-axi box view imbox --quiet             # drop HEY's summary/notice/breadcrumbs; keep data, count and hints
hey-axi reply 123 --message - < note.txt   # message body from stdin (saved as a draft)
hey-axi setup scope --label Acme           # per-directory home view (.hey-axi.json)
hey-axi --version                          # bare hey-axi version (fast path); `hey-axi version` adds HEY's
hey-axi box view imbox --ids-only          # raw HEY output (also --count/--markdown/--html/--styled/--jq)
hey-axi set-aside group view 4 --limit 5   # three-word commands
hey-axi move --help                        # usage, flags, examples, notes (no HEY call)
```

### Output shaping

- **Home view.** `hey-axi` with no arguments prints `bin`, `description`, the `scope`, a one-line `last_session` summary (when session capture is on), a `count` of threads, the 10 newest threads, and `help` lines with next commands (including how to see the rest). If HEY is missing, signed out or failing, it prints `status` with the fix and still exits 0.
- **Directory scope.** `hey-axi setup scope --label Acme` (or `--box`, `--search`, `--account`, `--limit`) writes `.hey-axi.json` in the current directory. The home view in that directory (or any subdirectory) then shows that label, box or search instead of the Imbox, and carries `--account` into every suggested command. `--status` shows it, `--remove` deletes it, and re-running with the same values is a no-op.
- **Minimal fields.** List commands show at most 4 columns (usually an id, the thread id, sender and subject). The defaults per command are in `src/shape.js` and in each command's `--help`. `--fields a,b,c` picks columns, using default aliases (`from`, `subject`, `at`) or dotted paths (`creator.email_address`, `messages.0.summary`); `--fields all` keeps everything. An unknown field exits 2 and lists what's available.
- **Truncation.** Strings longer than 1000 characters (120 in list cells) are cut and marked `… (truncated, N chars total)`, and a `help` line suggests `--full`.
- **Aggregates and empty states.** Every list gets a `count`: `N of T total` when HEY reports a total, `N total` when the list is complete, or `N shown; more available` with a `help` line naming `--all`/`--page`/`--limit` when HEY says there's more. An empty list prints ``empty: 0 results for `…` ``, and a command with no data prints `result: no data returned`. Non-JSON success output is wrapped as `ok: true` + `output`.
- **Help lines.** HEY's breadcrumbs (next-command hints) become ``help: Run `hey-axi …` to …``, HEY's hints are rewritten to name `hey-axi`, and `--account`/`--base-url` are carried into them.
- **Fail loud.** Unknown commands (with "did you mean"), unknown flags, flags with a missing or wrongly typed value (`--limit abc`), missing or extra arguments (`thread read` without an id), and missing required flags (`move` without `--to`) all exit 2 before HEY runs, with the valid usage.
- **Idempotent mutations.** When HEY reports that a change is already in place (code `conflict`/`already_exists`, or "already …" text) or a delete target is already gone, hey-axi prints `ok: true`, `noop: true` and exits 0.
- **Complete per-command help.** `hey-axi <command> --help` lists arguments, every flag with its type and default, global flags, and 2-3 examples, with no HEY call.
- `--full` turns all of this off, and `--json` prints the same shaped result as compact JSON.

### How each kind of command runs

| Kind | Commands | Behavior |
|---|---|---|
| JSON (default) | almost everything | `hey … --json` → TOON (or compact JSON with `--json`) |
| Raw output | `--ids-only`, `--count`, `--markdown`, `--html`, `--styled`, `--jq`; `shell-completion generate`; `timetrack export` without `--output` | HEY's output is printed as-is |
| Stream | `watch` | NDJSON relayed line by line as events arrive; Ctrl-C/SIGTERM forwarded to HEY |
| Needs a person | `tui`, `mcp`, the `setup` wizard, `auth login`/`login` without `--token`/`--cookie` | Without a terminal on stdin and stdout, hey-axi refuses (exit 2) and names the non-interactive alternative (e.g. ask the user to run `hey-axi auth login` in their terminal, or pass `--token`). In a real terminal, HEY gets the terminal |
| Captured | other `setup …` commands, `upgrade`, `auth login --token …` | Run with stdin closed, `HEY_NONINTERACTIVE=1` and `EDITOR`/`VISUAL=false`, so nothing can wait for input; output is shaped like any other command |

### Safety rails

- **Nothing is sent without an opt-in** (`--allow-send` or `HEY_AXI_ALLOW_SEND=1`):
  - `compose` and `reply` are **saved as drafts**. hey-axi adds `--draft`, and the output starts with `sent: false`, `saved_as: draft` and an `axi_notice` (also printed to stderr).
  - `forward`, `draft send` and `bulk-reply send` have no draft mode in HEY, so they're refused (exit 2) with the safe alternative (`reply … --to`, `draft show`, `bulk-reply preview`).
  - If you pass `--draft` or `--dry-run` yourself, hey-axi adds and marks nothing.
- **Credentials stay out of agent context.** `auth token` needs `--allow-secret` or `HEY_AXI_ALLOW_SECRETS=1`.
- **Content-first.** `compose`, `reply`, `draft edit`, `journal write`, `contact note set` and `bulk-reply send` must be given their content (`--message`, `--message -` for stdin, or a positional) and are refused (exit 2) otherwise, so HEY never opens an editor.
- hey-axi's own flags (`--allow-send`, `--allow-secret`, `--fields`, `--full`) are never forwarded to HEY.

### Errors and exit codes

Errors are printed as structured TOON on stdout: `ok: false`, `error`, a `kind`, and, when HEY gave them, `code`, `hint` and `meta`, plus a `help` next step. Raw HEY stderr is never passed through: debug noise (ANSI codes, Go stack traces) is dropped, and real warnings go to stderr as `warning: …`.

| Exit | Meaning |
|---|---|
| 0 | success (including no-op mutations and empty results) |
| 1 | the command failed; `kind` says why: `not_found`, `auth`, `forbidden`, `rate_limited`, `network`, `api_error`, `ambiguous`, `hey_missing`, `command_error` |
| 2 | usage error (`kind: usage`): unknown command/flag/field, bad flag value, missing or extra arguments, missing required flag or content, blocked send, a person-only command without a terminal, or a usage error reported by HEY |

## Agent integrations: session hook or skill

There are two ways to give an agent hey-axi. You only need one:

1. **Session hooks (recommended where supported):** `hey-axi setup hooks` registers the home view as session-start context, and a session-end hook (`hey-axi hook session-end`), for **Claude Code** (`~/.claude/settings.json`), **Codex** (`~/.codex/hooks.json`, and it turns on `[features].hooks` in `~/.codex/config.toml`) and **OpenCode** (a managed plugin in `~/.config/opencode/plugins/`). Every new session then starts with your Imbox summary and the next commands, and no tool call is needed.
   - `--project` writes to the current directory's `.claude/`, `.codex/` and `.opencode/` instead.
   - `--status` reports what's installed, and `--remove` removes only hey-axi's entries.
   - Re-running is a no-op, or repairs the path if hey-axi moved. It uses [axi-sdk-js](https://www.npmjs.com/package/axi-sdk-js)'s installer.
   - The session-end hook records a one-line summary of what the session did (drafts saved, messages sent, other changes; command names and numeric ids only, never message content) under `$XDG_STATE_HOME/hey-axi` (or `$HEY_AXI_STATE_DIR`), and the next home view shows it as `last_session`. Nothing is recorded unless `setup hooks` turned it on, and `setup hooks --remove` turns it off. OpenCode has no exact session-end event, so its plugin records on `session.idle`/`session.deleted`.
   - Note that the hook puts Imbox senders and subjects into every session's context.
2. **Agent skill (broader support, loads on demand):** see below.

### Agent skill

[`skills/hey-axi/SKILL.md`](skills/hey-axi/SKILL.md) is an [Agent Skills](https://agentskills.io/specification) package. It tells coding agents (Claude Code, Codex, Cursor, Gemini CLI, Copilot, …) when and how to use hey-axi: setup checks, triage commands, which id goes where, drafts-by-default, output modes, `watch` and exit codes. [`references/commands.md`](skills/hey-axi/references/commands.md) lists every command and is generated from the manifest (`npm run skill:gen`).

Installing the skill doesn't install the CLI. Install `hey` and `hey-axi` first (see [Install](#install)).

```bash
# with the skills CLI (https://skills.sh), from GitHub
npx skills add TangentialSolutions/hey-axi            # this project
npx skills add TangentialSolutions/hey-axi -g -a claude-code   # user-wide, Claude Code only

# with GitHub CLI (gh skill, preview)
gh skill install TangentialSolutions/hey-axi hey-axi --agent claude-code --scope user

# manually
cp -r skills/hey-axi ~/.claude/skills/               # or ~/.agents/skills/, ~/.codex/skills/, …
```

See [docs/listing.md](docs/listing.md) for how hey-axi gets listed on skills.sh and axi.md.

## Keeping up with HEY releases

`src/manifest.json` is a snapshot of `hey commands --json`. To regenerate it from whichever `hey` you have installed:

```bash
npm run refresh-manifest     # runs only `hey version` and `hey commands`
```

hey-axi routes only from the snapshot, so an unknown command is rejected immediately (exit 2, with suggestions) without running HEY. New HEY commands become available after a refresh and a hey-axi release. A weekly GitHub Action (`manifest-drift`) fails when the snapshot falls behind the latest HEY release.

## Development

```bash
npm test     # node:test; every test uses a fake `hey` (test/helpers.js), never the real CLI
```

Token benchmark (HEY CLI vs hey-axi output): [docs/benchmarks.md](docs/benchmarks.md), with `npm run bench:tokens`.

See [AGENTS.md](AGENTS.md) for the code map and conventions, and [SCHEDULED_HEY_CLI.md](SCHEDULED_HEY_CLI.md) for running triage on a schedule.

## License

[MIT](LICENSE) © 2026 TangentialSolutions. hey-axi is an independent project. It isn't affiliated with or endorsed by Basecamp or HEY.
