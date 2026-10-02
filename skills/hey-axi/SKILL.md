---
name: hey-axi
description: Read, triage and draft HEY email (and HEY calendars, todos, habits, journal, time tracking) from the shell through hey-axi, a token-efficient TOON wrapper around Basecamp's HEY CLI that saves outgoing mail as drafts unless sending is explicitly allowed. Use when the user asks you to check, search, read, summarize, sort, label, screen, archive or reply to their HEY (hey.com) email, watch for new mail, or manage HEY todos, events, habits, journal entries or time tracks.
compatibility: Requires Node.js 20+, the HEY CLI (`hey`, v1.7.0 or newer) signed in to a HEY account, and network access to app.hey.com.
metadata:
  author: TangentialSolutions
  repository: https://github.com/TangentialSolutions/hey-axi
---

# hey-axi: HEY email for agents

`hey-axi` runs Basecamp's HEY CLI (`hey`), asks for its JSON envelope and prints it as TOON, which is compact and costs fewer tokens than `hey --json`. Every `hey` command works: `hey-axi <same args as hey>`.

## 1. Check setup first

```bash
hey-axi auth status        # are we signed in?
hey-axi doctor             # login/config problems
```

- `hey-axi: command not found`: install it (see "Install" below), or run `node <repo>/src/hey-axi.js`.
- exit **127**: `hey` isn't installed or isn't on PATH. Set `HEY_BIN=/path/to/hey` (cron/launchd jobs usually need `HEY_BIN=$HOME/.local/bin/hey`).
- exit **3** (auth): ask the **user** to run `hey auth login` in their own terminal. It opens a browser. Don't try to sign in for them, and never print tokens (`auth token` is blocked unless `--allow-secret` is passed).

## 2. Read and triage

```bash
hey-axi box list                          # boxes and their ids
hey-axi box view imbox --limit 25         # rows in a box (imbox, feed, papertrail, aside, later, …)
hey-axi thread read <topic_id>            # full thread
hey-axi search "invoice" --from a@b.com --date last_30_days
hey-axi screener list                     # senders waiting to be screened
hey-axi set-aside view   |   hey-axi bubble list   |   hey-axi draft list
```

**Which id to use.** Each `box view` row has an `id` (the box item) and a `topic_id` (the thread):
- `topic_id` goes to `thread read`, `reply` and `forward`.
- `id` goes to `seen`, `unseen`, `move`, `label`, `bubble`, `trash`, `spam` and `ignore`.
- A row with kind `bundle` has no `topic_id`. Open it with `hey-axi bundle view <id>`.
- Screener commands take the clearance `id` from `screener list`. These aren't contact ids.

```bash
hey-axi seen <id>...           hey-axi unseen <id>...
hey-axi move <id>... --to feed          # imbox | feed | aside | later | papertrail
hey-axi label add <id>... --to "Receipts"
hey-axi bubble up <id>... --tomorrow    # or --now | --on <date> | --weekend | --next-week
hey-axi screener approve <clearance-id> hey-axi screener deny <clearance-id>
hey-axi trash <id>...          hey-axi spam <id>...      hey-axi ignore <id>...
```

`trash`, `spam`, `ignore`, `screener deny --spam` and `screener clear` (which clears the whole queue) run without any confirmation. Confirm with the user before you run them in bulk.

Output includes HEY's `next`/breadcrumb hints. Follow them for paging (`--page N`, `--all`) and follow-up commands instead of guessing. `hey <command> --help` explains a command in depth.

## 3. Writing mail: drafts by default

- `compose` and `reply` are **saved as drafts** automatically. The output starts with `sent: false`, `saved_as: draft` and an `axi_notice`. Tell the user that a draft is waiting in HEY. Don't claim it was sent.
  ```bash
  hey-axi reply <topic_id> --message "Thanks, Thursday works."
  hey-axi compose --to a@b.com --subject "Hi" --message "…"
  hey-axi draft list   |   hey-axi draft show <draft-id>
  ```
- `forward`, `draft send` and `bulk-reply send` are **refused** (exit 2) because HEY has no draft mode for them. The error names the safe alternative.
- To actually send, the user must explicitly ask you to, and you add `--allow-send` (or they set `HEY_AXI_ALLOW_SEND=1`). Don't add it on your own initiative.

## 4. Output modes

| Want | Use |
|---|---|
| Default: data + notice + next hints, as TOON | (nothing) |
| HEY's envelope as compact JSON | `--json` |
| Data only, no envelope | `--quiet` |
| Raw HEY output | `--ids-only`, `--count`, `--markdown`, `--html`, `--styled`, `--jq '<expr>'` |
| Help for one command (no network) | `hey-axi <command> --help` |

Global flags such as `--account <id|all>` can go anywhere in the command.

## 5. Watching for changes

`hey-axi watch` streams HEY's NDJSON one line at a time until it's interrupted. Use bounded forms in agent sessions:

```bash
hey-axi watch --box imbox --events new --exit-on-first --timeout 10m
```

Lines also include `ready`, `disconnected` and `resync`. On `resync`, re-read that box.

## 6. Errors and exit codes

Errors are TOON on stdout: `ok: false`, `error`, plus `code`/`hint`/`meta` when HEY provided them, and `exit_code`. Exit codes: 0 ok · 1 usage · 2 not found or hey-axi refusal · 3 auth · 4 forbidden · 5 rate limit · 6 network · 7 API · 8 ambiguous · 127 `hey` missing. Read `hint` before you retry.

## Install

```bash
# HEY CLI (macOS/Linux)
curl -fsSL https://hey.com/install-cli | bash        # or: brew install --cask basecamp/tap/hey
hey auth login                                      # the user runs this once, interactively

# hey-axi
git clone https://github.com/TangentialSolutions/hey-axi && cd hey-axi
npm ci && npm link                                  # puts `hey-axi` on PATH
```

More commands (calendar, todos, habits, journal, time tracking, contacts, collections): [references/commands.md](references/commands.md).
