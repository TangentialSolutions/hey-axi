# hey-axi

An agent-friendly wrapper for [HEY CLI](https://github.com/basecamp/hey-cli) (`hey`), Basecamp's command line for HEY email, calendars, todos, habits, time tracking and journals.

hey-axi runs `hey`, asks for its JSON response envelope, and prints it as [TOON](https://github.com/toon-format/toon), which is compact and costs agents fewer tokens. It also adds a few safety rails. It covers **every command in HEY CLI v1.7.0** (144 commands, plus the `login`/`logout` aliases and the `box <id>`-style shortcuts) by routing from HEY's own `hey commands --json` catalog.

## Install

Requirements: Node 20+ and an authenticated HEY CLI (`curl -fsSL https://hey.com/install-cli | bash`, then `hey auth login`).

```bash
git clone https://github.com/TangentialSolutions/hey-axi && cd hey-axi
npm ci
npm link            # puts `hey-axi` on your PATH
```

hey-axi uses `$HEY_BIN` if it's set, and otherwise finds `hey` on `PATH`. launchd/cron jobs usually have a minimal PATH, so set `HEY_BIN=$HOME/.local/bin/hey` there.

## Usage

```bash
hey-axi box view imbox                     # TOON: data + notice/next_page/breadcrumbs
hey-axi box imbox                          # HEY's shortcut forms work too
hey-axi --account 2 search --from a@b.com  # global flags anywhere
hey-axi thread read 123 --json             # HEY's envelope as compact JSON
hey-axi box view imbox --quiet             # data only, no envelope
hey-axi box view imbox --ids-only          # raw HEY output (also --count/--markdown/--html/--styled/--jq)
hey-axi set-aside group view 4 --limit 5   # three-word commands
hey-axi workflow --help                    # per-command help from the manifest (no HEY call)
```

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
- hey-axi's own flags (`--allow-send`, `--allow-secret`) are never forwarded to HEY.

### Errors and exit codes

Errors are printed as structured TOON: `ok: false`, `error`, and, when HEY gave them, `code`, `hint`, `meta`, plus `exit_code`. hey-axi passes HEY's exit code through: 1 usage, 2 not found, 3 auth, 4 forbidden, 5 rate limit, 6 network, 7 API, 8 ambiguous (`hey help exit-codes`). hey-axi's own refusals (unknown/incomplete command, blocked send, missing TTY) exit **2**. If `hey` can't be found, hey-axi exits **127**.

## Agent skill

[`skills/hey-axi/SKILL.md`](skills/hey-axi/SKILL.md) is an [Agent Skills](https://agentskills.io/specification) package. It tells coding agents (Claude Code, Codex, Cursor, Gemini CLI, Copilot, …) when and how to use hey-axi: setup checks, triage commands, which id goes where, drafts-by-default, output modes, `watch` and exit codes. [`references/commands.md`](skills/hey-axi/references/commands.md) lists every command and is generated from the manifest (`npm run skill:reference`).

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

While the repository is private, `npx skills add` and `gh skill install` work only for people with access (they use your git/gh credentials). See [docs/listing.md](docs/listing.md) for the public-listing checklist.

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
