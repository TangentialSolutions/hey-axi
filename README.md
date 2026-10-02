# hey-axi

An agent-friendly wrapper for [HEY CLI](https://github.com/basecamp/hey-cli) (`hey`), Basecamp's command line for HEY email, calendars, todos, habits, time tracking and journals.

hey-axi runs `hey`, asks for its JSON response envelope, and prints it as [TOON](https://github.com/toon-format/toon). It follows the [AXI](https://axi.md) principles: a live home view, minimal default fields, truncated long text, definitive empty states, and unknown flags rejected up front. On our synthetic benchmark that's **~89% fewer tokens than `hey --json`** ([docs/benchmarks.md](docs/benchmarks.md)). It also adds a few safety rails. It covers **every command in HEY CLI v1.7.0** (144 commands, plus the `login`/`logout` aliases and the `box <id>`-style shortcuts) by routing from HEY's own `hey commands --json` catalog.

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
hey-axi                                    # home view: who/what, the Imbox (10 threads), next commands
hey-axi box view imbox                     # TOON: summary, a few columns per thread, notice, help
hey-axi box imbox                          # HEY's shortcut forms work too
hey-axi --account 2 search --from a@b.com  # global flags anywhere
hey-axi thread read 123                    # bodies cut at 1000 chars with "(truncated, N chars total)"
hey-axi thread read 123 --full             # HEY's complete, untouched result
hey-axi box view imbox --fields id,subject,creator.email_address   # choose columns (--fields all = every field)
hey-axi thread read 123 --json             # the same shaped output as compact JSON
hey-axi box view imbox --quiet             # data only, no envelope
hey-axi --version                          # bare hey-axi version (fast path); `hey-axi version` adds HEY's
hey-axi box view imbox --ids-only          # raw HEY output (also --count/--markdown/--html/--styled/--jq)
hey-axi set-aside group view 4 --limit 5   # three-word commands
hey-axi move --help                        # usage, flags, examples, notes (no HEY call)
```

### Output shaping

- **Home view.** `hey-axi` with no arguments prints `bin`, `description`, the Imbox summary and its 10 newest threads, and `help` lines with next commands. If HEY is missing, signed out or failing, it prints `status` with the fix and still exits 0.
- **Minimal fields.** List commands show a few columns. The defaults per command are in `src/shape.js` and in each command's `--help`. `--fields a,b,c` picks columns, using default aliases (`from`, `subject`, `at`) or dotted paths (`creator.email_address`, `messages.0.summary`); `--fields all` keeps everything. An unknown field exits 2 and lists what's available.
- **Truncation.** Strings longer than 1000 characters (120 in list cells) are cut and marked `… (truncated, N chars total)`, and a `help` line suggests `--full`.
- **Aggregates and empty states.** `count: N of T total` when HEY reports a total; ``empty: 0 results for `…` `` when a list is empty.
- **Help lines.** HEY's breadcrumbs become ``help: Run `hey-axi …` to …``, and HEY's hints are rewritten to name `hey-axi`.
- **Fail loud.** Unknown flags and missing required flags (`move` without `--to`) exit 2 before HEY runs, listing the valid flags.
- `--full` turns all of this off, and `--json` prints the same shaped result as compact JSON.

### How each kind of command runs

| Kind | Commands | Behavior |
|---|---|---|
| JSON (default) | almost everything | `hey … --json` → TOON (or compact JSON with `--json`) |
| Raw output | `--ids-only`, `--count`, `--markdown`, `--html`, `--styled`, `--jq`; `shell-completion generate`; `timetrack export` without `--output` | HEY's output is printed as-is |
| Stream | `watch` | NDJSON relayed line by line as events arrive; Ctrl-C/SIGTERM forwarded to HEY |
| Interactive | `tui`, `auth login`/`login`, `setup …`, `mcp`, `upgrade` | HEY gets the terminal (inherited stdio). `tui` refuses to start without a TTY |

### Safety rails

- **Nothing is sent without an opt-in** (`--allow-send` or `HEY_AXI_ALLOW_SEND=1`):
  - `compose` and `reply` are **saved as drafts**. hey-axi adds `--draft`, and the output starts with `sent: false`, `saved_as: draft` and an `axi_notice` (also printed to stderr).
  - `forward`, `draft send` and `bulk-reply send` have no draft mode in HEY, so they're refused (exit 2) with the safe alternative (`reply … --to`, `draft show`, `bulk-reply preview`).
  - If you pass `--draft` or `--dry-run` yourself, hey-axi adds and marks nothing.
- **Credentials stay out of agent context.** `auth token` needs `--allow-secret` or `HEY_AXI_ALLOW_SECRETS=1`.
- hey-axi's own flags (`--allow-send`, `--allow-secret`, `--fields`, `--full`) are never forwarded to HEY.

### Errors and exit codes

Errors are printed as structured TOON: `ok: false`, `error`, and, when HEY gave them, `code`, `hint`, `meta`, plus a `help` next step (when HEY gave no hint) and `exit_code`. hey-axi passes HEY's exit code through: 1 usage, 2 not found, 3 auth, 4 forbidden, 5 rate limit, 6 network, 7 API, 8 ambiguous (`hey help exit-codes`). hey-axi's own refusals (unknown/incomplete command, unknown flag or field, missing required flag, blocked send, missing TTY) exit **2**. If `hey` can't be found, hey-axi exits **127**.

## Agent integrations: session hook or skill

There are two ways to give an agent hey-axi. You only need one:

1. **Session hook (recommended where supported):** `hey-axi setup hooks` registers the home view as session-start context for **Claude Code** (`~/.claude/settings.json`), **Codex** (`~/.codex/hooks.json`, and it turns on `[features].hooks` in `~/.codex/config.toml`) and **OpenCode** (a managed plugin in `~/.config/opencode/plugins/`). Every new session then starts with your Imbox summary and the next commands, and no tool call is needed.
   - `--project` writes to the current directory's `.claude/`, `.codex/` and `.opencode/` instead.
   - `--status` reports what's installed, and `--remove` removes only hey-axi's entries.
   - Re-running is a no-op, or repairs the path if hey-axi moved. It uses [axi-sdk-js](https://www.npmjs.com/package/axi-sdk-js)'s installer.
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

If the snapshot doesn't know a command, hey-axi asks the installed `hey commands --json` at runtime before reporting `unknown command`. So newer HEY releases work even before the snapshot is refreshed. A weekly GitHub Action (`manifest-drift`) fails when the snapshot falls behind the latest HEY release.

## Development

```bash
npm test     # node:test; every test uses a fake `hey` (test/helpers.js), never the real CLI
```

Token benchmark (HEY CLI vs hey-axi output): [docs/benchmarks.md](docs/benchmarks.md), with `npm run bench:tokens`.

See [AGENTS.md](AGENTS.md) for the code map and conventions, and [SCHEDULED_HEY_CLI.md](SCHEDULED_HEY_CLI.md) for running triage on a schedule.

## License

[MIT](LICENSE) © 2026 TangentialSolutions. hey-axi is an independent project. It isn't affiliated with or endorsed by Basecamp or HEY.
