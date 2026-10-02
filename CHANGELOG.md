# Changelog

All notable changes to hey-axi. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [semver](https://semver.org/).

## 0.3.0 (2026-10-02)

Closes the gaps from the axi.md admission review (AXI principles 2-7, 9 and 10). The rules that were already in place stay as they were: nothing is sent without `--allow-send`, tests use a fake HEY, and HEY's next-command hints (breadcrumbs) are still shown.

### Added
- **Directory scope (principle 7):** `hey-axi setup scope --box|--label|--search [--account] [--limit]` writes `.hey-axi.json`. The home view in that directory tree shows the scoped mailbox view and carries `--account` into its suggestions. It has `--status` and `--remove`, and running it again is a no-op.
- **Session-end hooks (principle 7):** `hey-axi setup hooks` now also installs a session-end hook for Claude Code, Codex and OpenCode. It records a one-line summary of the session (drafts, sends, other changes; command names and numeric ids only), and the next home view shows it as `last_session` (one line, at most 300 characters). Entries are tagged with the agent's session id when the harness provides one, so concurrent sessions stay apart.
- **Counts everywhere (principles 4 and 9):** every list, including bare non-envelope lists, lists of plain values and results with several lists, gets a `count` (`N of T total`, `N total`, `N shown; more available`, or `N shown; no more pages reported`; hey-axi only says `total` when HEY does). Totals and cursors that HEY puts next to the list (box listings) are used too, results with several lists report HEY's total and paging, content next to a list is kept (truncated) rather than dropped, and the home view never calls an empty page "nothing" when HEY reports more. The home view shows a thread count, a `--full` hint when it truncates, and how to see the rest of a truncated list.
- **Idempotent mutations (principle 6):** for state-setting commands, a HEY failure that says the command's own end state already holds (per-command patterns), or a delete whose target is already gone, gives `ok: true, noop: true` and exits 0. Reads, sends, generic conflicts, `move` to a different destination than HEY names, and "already exists" on creates stay errors.
- **Strict argument checks (principle 6):** missing or extra positional arguments, flags with a missing value, and wrongly typed values (for example `--limit abc`) all exit 2 before HEY runs. Unknown commands get "did you mean" suggestions.
- **Content-first writes (principle 6):** `compose`, `reply`, `draft edit`, `journal write`, `contact note set` and `bulk-reply send` must be given their content. `--message -` reads the body from stdin.
- **Account carried into suggestions (principle 9):** HEY's next-command hints (object and string breadcrumbs, notices) and error fix-it lines keep `--account`/`--base-url` from the invocation.
- **Complete `--help` (principle 10):** per-command help lists arguments, every flag with its type and default, every global flag with its default, and 2-3 examples. The home view's `bin` is always an absolute path (with `~`).
- `CHANGELOG.md`.

### Changed
- **Minimal default fields (principle 2):** list views show at most 4 columns.
- **Definitive empty states (principles 3 and 5):** bare lists get an explicit empty state, `--quiet` keeps it, long plain-text output is cut with a `--full` hint, and a command that returns no data prints `result: no data returned`, and non-JSON success output is wrapped as `ok: true` + `output`.
- **Structured errors and exit codes (principle 6):** errors have a `kind`; exit codes are now 0 = success, 1 = failure, 2 = usage error (HEY's 1-8 codes are no longer passed through, and `exit_code` was removed from error output). HEY's own error envelopes are translated too (one clean line; no stack traces; debug keys dropped from `meta`). `raw` and `stream` modes report failures as structured errors, and raw output is held until HEY succeeds, so a failed run prints only the error. Switches given a value (`--draft=false`, also on `setup hooks`/`setup scope`) and unknown letters in stacked shorthands (`-vZ`) are refused. A HEY killed by a signal is reported as a failure (exit 1). Refusals carry `--account`/`--base-url` into their suggestions too.
- **Never wait for input (principle 6):** `tui`, `mcp`, the `setup` wizard and browser `auth login` are refused (exit 2) unless the new `--interactive` opt-in is passed, terminal or not, with a hint for the alternative. Other `setup` commands and `upgrade` run captured, with stdin closed and `HEY_NONINTERACTIVE=1`.
- `--quiet` now means hey-axi drops HEY's summary, notice, breadcrumbs and meta, but keeps the data, count and hey-axi's hints. It is no longer passed to HEY.
- **No runtime discovery:** unknown commands are rejected from the manifest snapshot alone, without running `hey commands`.
- `set-aside`, `set-aside group` and `skill` are runnable (154 runnable command paths).
- The manifest records every flag default and flag type.
- The agent skill and the home view suggest `npx -y hey-axi …` (principle 7: skill examples must run without a global install).
- Regenerated `docs/benchmarks.md` and `skills/hey-axi/references/commands.md`.

## 0.2.0

- Home view, `--version` fast path, minimal default fields, truncation, session-start hooks (Claude Code, Codex, OpenCode), unknown flags rejected up front, the agent skill, and npm packaging (MIT).

## Earlier

- Data-driven routing from `hey commands --json`, global flags anywhere, raw output selectors, the send gate (compose/reply staged as drafts), streaming `watch`, and HEY error parsing.
