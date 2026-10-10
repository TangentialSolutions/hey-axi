# hey-axi

[![skills.sh](https://skills.sh/b/TangentialSolutions/hey-axi)](https://skills.sh/TangentialSolutions/hey-axi) [![npm](https://img.shields.io/npm/v/hey-axi.svg)](https://www.npmjs.com/package/hey-axi) [![test](https://github.com/TangentialSolutions/hey-axi/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/TangentialSolutions/hey-axi/actions/workflows/test.yml)

An agent-friendly wrapper for [HEY CLI](https://github.com/basecamp/hey-cli) (`hey`), Basecamp's command line for HEY email, calendars, todos, habits, time tracking and journals.

hey-axi runs `hey`, asks for its JSON response envelope, and prints it as [TOON](https://github.com/toon-format/toon). It follows the [AXI](https://axi.md) principles: a live home view, minimal default fields, truncated long text, definitive empty states, and unknown flags rejected up front. On our synthetic benchmark that's **~89% fewer tokens than `hey --json`** ([docs/benchmarks.md](docs/benchmarks.md)). It also adds a few safety rails. It covers **every command in HEY CLI v1.8.0** (released 2026-10-09; commit `732568e`): 156 runnable command paths, including the `login`/`logout` aliases, plus the `box <id>`-style shortcuts. It routes from a snapshot of HEY's own `hey commands --json` catalog. Commands added since v1.7.0 (`contact deliver`, `event delete --occurrence/--apply-to`, `screener clear`, `thread update`) need HEY v1.8.0 or newer; with an older HEY they fail with `kind: hey_outdated`. See [CHANGELOG.md](CHANGELOG.md) for what changed in each release.

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
hey-axi thread update 123 --name "Kitchen renovation quotes"   # rename a thread (nothing is emailed)
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
- **Aggregates and empty states.** Every list gets a `count`: `N of T total` when HEY reports a total (in `meta` or next to the list), `N total` when HEY says the list is complete, `N shown; more available` with a `help` line naming `--all`/`--page`/`--limit` when HEY says there's more, and `N shown; no more pages reported` when HEY says neither. Lists of plain values and results holding several lists (`2 todos, 1 habits`) are counted too. An empty list prints ``empty: 0 results for `…` ``, and a command with no data prints `result: no data returned`. Non-JSON success output is wrapped as `ok: true` + `output`.
- **Help lines.** A list always ends with a next step: HEY's own, or (when HEY gives none) the matching `view`/`show` command. HEY's breadcrumbs (next-command hints) become ``help: Run `hey-axi …` to …``, HEY's hints are rewritten to name `hey-axi`, and `--account`/`--base-url` are carried into them.
- **Fail loud.** Unknown commands (with "did you mean"), unknown flags, flags with a missing or wrongly typed value (`--limit abc`), missing or extra arguments (`thread read` without an id), and missing required flags (`move` without `--to`) all exit 2 before HEY runs, with the valid usage.
- **Idempotent mutations.** For state-setting commands (`seen`, `todo complete`, `label add`, `move`, `screener approve`, `timetrack stop`, name-based `create`s, …), when HEY's failure says that command's own end state already holds ("already seen", "already completed", "already exists", …), and for deletes whose target is already gone, hey-axi prints `ok: true`, `noop: true` and exits 0. The patterns are per command (`END_STATES` in `src/policy.js`); a generic conflict, any read, any send or reply, a `move` whose failure names a different box than `--to`, "already exists" on a create, and a delete whose not-found names something other than the target stay errors.
- **Complete per-command help.** `hey-axi <command> --help` lists arguments, every flag with its type and default, global flags, and 2-3 examples, with no HEY call.
- `--full` turns all of this off, and `--json` prints the same shaped result as compact JSON.

### How each kind of command runs

| Kind | Commands | Behavior |
|---|---|---|
| JSON (default) | almost everything | `hey … --json` → TOON (or compact JSON with `--json`) |
| Raw output | `--ids-only`, `--count`, `--markdown`, `--html`, `--styled`, `--jq`; `shell-completion generate`; `timetrack export` without `--output` | HEY's output is printed as-is once HEY succeeds; on failure only a structured error is printed |
| Stream | `watch` | Each event printed as it arrives, as a TOON block followed by a blank line (`--json`: HEY's NDJSON, one line per event); Ctrl-C/SIGTERM forwarded to HEY |
| Needs a person | `tui`, `mcp`, the `setup` wizard, `auth login`/`login` without `--token`/`--cookie` | Refused (exit 2) unless `--interactive` is passed, terminal or not, with the alternative (e.g. pass `--token`, or ask the user to run `hey-axi auth login --interactive` in their terminal). With `--interactive`, HEY gets the terminal (for `mcp`, its stdio, so an MCP client can register `hey-axi mcp --interactive`); the others also need a real terminal |
| Captured | other `setup …` commands, `upgrade`, `auth login --token …` | Run with stdin closed, `HEY_NONINTERACTIVE=1` and `EDITOR`/`VISUAL=false`, so nothing can wait for input; output is shaped like any other command |

### Safety rails

- **Nothing is sent without an opt-in** (`--allow-send` or `HEY_AXI_ALLOW_SEND=1`):
  - `compose` and `reply` are **saved as drafts**. hey-axi adds `--draft`, and the output starts with `sent: false`, `saved_as: draft` and an `axi_notice` (also printed to stderr).
  - `forward`, `draft send` and `bulk-reply send` have no draft mode in HEY, so they're refused (exit 2) with the safe alternative (`reply … --to`, `draft show`, `bulk-reply preview`).
  - If you pass `--draft` or `--dry-run` yourself, hey-axi adds and marks nothing.
  - With `--allow-send`, a send HEY confirms is marked `sent: true` (and names the delivered message's `id`/`topic_id` when HEY reports them, as HEY main does). If HEY holds it for Undo Send (`delayed: true`), a `held` line says it hasn't gone out yet and the thread won't show it until it does.
  - If HEY refuses to send and keeps the message as a draft (HEY v1.8.0's `not_delivered`, usually the sending limit), the result is an error with `kind: not_delivered`, `sent: false` and the draft id, and says not to repeat the send. HEY v1.7.0 reports such a send as sent, so it can't be detected there.
  - Recipients HEY would silently drop (no domain or top-level domain, like `bob` or `bob@example`) are refused (exit 2, `sent: false`) before HEY runs, for `compose`, `reply`, `forward` and `draft edit`. HEY v1.8.0's own "not a valid email address" refusal is reported the same way.
- **Credentials stay out of agent context.** `auth token` needs `--allow-secret` or `HEY_AXI_ALLOW_SECRETS=1`.
- **Destructive commands need an opt-in.** `screener clear` (HEY v1.8.0) moves everything waiting in the Screener to Trash, for every sender, and HEY asks for no confirmation. hey-axi refuses it (exit 2, HEY isn't run, nothing changes) unless you pass `--allow-destructive` or set `HEY_AXI_ALLOW_DESTRUCTIVE=1`. The refusal says what it would do and suggests `screener list` and per-sender `screener deny` first.
- **Content-first.** `compose`, `reply`, `draft edit`, `journal write`, `contact note set` and `bulk-reply send` must be given their content (`--message`, `--message -` for stdin, or a positional) and are refused (exit 2) otherwise, so HEY never opens an editor.
- hey-axi's own flags (`--allow-send`, `--allow-secret`, `--allow-destructive`, `--interactive`, `--fields`, `--full`) are never forwarded to HEY. Switches take no value: `--draft=false` or `--allow-send=false` is refused (exit 2) rather than guessed at.

### Errors and exit codes

Errors are printed as structured TOON on stdout: `ok: false`, `error`, a `kind`, and, when HEY gave them, `code`, `hint` and `meta`, plus a `help` next step. HEY's error text is translated too: only its first meaningful line is kept, stack traces, panics and terminal escapes are dropped, and debug keys (`stack`, `trace`, …) are removed from `meta`. On success HEY's stderr notices (warnings, `next_page: …`) go to stderr without that noise.

| Exit | Meaning |
|---|---|
| 0 | success (including no-op mutations and empty results) |
| 1 | the command failed; `kind` says why: `not_found`, `auth`, `forbidden`, `rate_limited`, `network`, `api_error`, `ambiguous`, `hey_missing`, `hey_outdated` (the installed HEY is older than the command needs), `not_delivered` (HEY kept a send as a draft), `command_error` |
| 2 | usage error (`kind: usage`): unknown command/flag/field, bad flag value, missing or extra arguments, missing required flag or content, a switch given a value (`--draft=false`), blocked send, a destructive command without `--allow-destructive`, a person-only command without `--interactive`, or a usage error reported by HEY |

## Agent integrations: session hook or skill

There are two ways to give an agent hey-axi. You only need one:

1. **Session hooks (recommended where supported):** `hey-axi setup hooks` registers the home view as session-start context, and a session-end hook (`hey-axi hook session-end`), for **Claude Code** (`~/.claude/settings.json`), **Codex** (`~/.codex/hooks.json`, and it turns on `[features].hooks` in `~/.codex/config.toml`) and **OpenCode** (a managed plugin in `~/.config/opencode/plugins/`). Every new session then starts with your Imbox summary and the next commands, and no tool call is needed.
   - `--project` writes to the current directory's `.claude/`, `.codex/` and `.opencode/` instead.
   - `--status` reports what's installed, and `--remove` removes only hey-axi's entries.
   - Re-running is a no-op, or repairs the path if hey-axi moved. It uses [axi-sdk-js](https://www.npmjs.com/package/axi-sdk-js)'s installer.
   - The session-end hook records a one-line summary (at most 300 characters) of what the session did (drafts saved, messages sent, other changes; command names and numeric ids only, never message content) under `$XDG_STATE_HOME/hey-axi` (or `$HEY_AXI_STATE_DIR`), and the next home view shows it as `last_session`. Nothing is recorded unless `setup hooks` turned it on, and `setup hooks --remove` turns it off. Entries are tagged with the agent session (`CLAUDE_CODE_SESSION_ID` in Claude Code, `CODEX_THREAD_ID` in Codex, or `HEY_AXI_SESSION_ID`) so concurrent sessions in one directory stay apart. OpenCode has no exact session-end event, so its plugin records on `session.idle`/`session.deleted`.
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

`src/manifest.json` is a snapshot of `hey commands --json` plus usage parsed from `hey <command> --help`. The current snapshot was built from basecamp/hey-cli `main` at the v1.8.0 release commit (`732568e`, 2026-10-09), so its `hey_version` reads `1.8.0`. To regenerate it:

```bash
npm run refresh-manifest     # from whichever `hey` you have installed (runs only `hey version`, `hey commands`, `hey <command> --help`)
npm run manifest:main        # clone basecamp/hey-cli main, build it (needs Go and git), and rewrite the manifest from it
npm run check-drift          # same build, but only compare: exits 1 with a readable diff when commands or flags differ
node scripts/check-drift.js --ref v1.8.0 --write   # a tagged release instead of main
```

hey-axi routes only from the snapshot, so an unknown command is rejected immediately (exit 2, with suggestions) without running HEY. New HEY commands become available after a refresh and a hey-axi release. The `upstream drift` GitHub Action builds HEY from basecamp/hey-cli `main` daily (and on changes to the manifest or scripts) and fails when its commands or flags differ from the snapshot; help-text-only changes are listed in the job summary without failing. It also warns when HEY publishes a release newer than the one the snapshot builds on.

## Development

```bash
npm test     # node:test; every test uses a fake `hey` (test/helpers.js), never the real CLI
```

Token benchmark (HEY CLI vs hey-axi output): [docs/benchmarks.md](docs/benchmarks.md), with `npm run bench:tokens`.

See [AGENTS.md](AGENTS.md) for the code map and conventions, and [SCHEDULED_HEY_CLI.md](SCHEDULED_HEY_CLI.md) for running triage on a schedule.

## License

[MIT](LICENSE) © 2026 TangentialSolutions. hey-axi is an independent project. It isn't affiliated with or endorsed by Basecamp or HEY.
