# Listing hey-axi (draft, nothing submitted)

This is the prep for getting hey-axi listed on [axi.md](https://axi.md) and the agent-skill directories. **None of these steps has been taken.** Every one of them needs the repo to be public first. Research was done on 2026-10-01; directory rules change, so re-check the linked sources before you submit.

## Prerequisites (owner decisions)

1. **Make the repo public.** Every directory below reads public GitHub repos. skills.sh telemetry is only sent for public repos ([vercel-labs/skills `src/add.ts`](https://github.com/vercel-labs/skills/blob/main/src/add.ts) sends it only when `isPrivate === false`).
2. **Add a license.** The repo has none today, which legally means "all rights reserved", so nobody may reuse it. HEY CLI is MIT, as are most AXI catalog entries, so MIT is the natural fit, but it's the owner's choice. Once chosen, add `LICENSE`, the `"license"` field in `package.json`, and optionally `license:` in `skills/hey-axi/SKILL.md`.
3. **npm publish (optional, recommended).** The name `hey-axi` is unclaimed on npm (checked 2026-10-01). Publishing allows `npm i -g hey-axi` / `npx -y hey-axi` instead of clone + `npm link`. To publish, drop `"private": true` from `package.json` and run `npm publish`. `files` is already set: the tarball has `src/`, `skills/` and `README.md`.
4. **GitHub topics** (help SkillsMP and GitHub search): `agent-skills`, `claude-skills`, `axi`, `hey`, `email`, `cli`.

## axi.md (community catalog)

Source: https://github.com/kunchenguid/axi. The catalog in [`catalog.yaml`](https://github.com/kunchenguid/axi/blob/main/catalog.yaml) is the single source of truth. The README and the axi.md tables are generated from it. Process per [CONTRIBUTING.md](https://github.com/kunchenguid/axi/blob/main/CONTRIBUTING.md):

1. Install [no-mistakes](https://github.com/kunchenguid/no-mistakes) (v1.30.1+ for fork PRs). PRs that weren't raised through no-mistakes fail the "Require no-mistakes" check and aren't reviewed.
2. Fork `kunchenguid/axi`, clone the fork, then `no-mistakes init --fork-url git@github.com:<you>/axi.git`.
3. Add **one** entry to the end of the `community:` list in `catalog.yaml` (draft below), run `pnpm install && pnpm run docs:gen` (Node 24), and commit `catalog.yaml`, `README.md` and `docs/index.html` together.
4. `git push no-mistakes`, then run `no-mistakes`. It runs its review/test pipeline and opens the PR.
5. Questions go to repo issues or the Discord linked from CONTRIBUTING.md.

**Admission review.** [VISION.md](https://github.com/kunchenguid/axi/blob/main/VISION.md) says a new package gets a positive admission verdict only after an independent reviewer inspects its source at a pinned revision against **all applicable AXI principles**. Entries end up `admitted`, `exception` (listed with documented deviations) or inconclusive. See the `admission:` blocks in `catalog.yaml`. Status against the AXI principles after the 0.2.0 changes (from the [AXI skill](https://github.com/kunchenguid/axi/blob/main/.agents/skills/axi/SKILL.md)):

| AXI principle | hey-axi 0.2.0 | Where |
|---|---|---|
| 1 TOON output | ✅ | `src/cli.js` `output()` |
| 2 Minimal default schemas / `--fields` | ✅ 3–6 columns per list command, `--fields a,b` / dotted paths / `--fields all`; unknown field → exit 2 | `src/shape.js` `LIST_FIELDS` |
| 3 Content truncation (`--full`) | ✅ >1000 chars (120 in list cells) cut with `… (truncated, N chars total)`; `--full` hint only when something was cut | `src/shape.js` `truncateDeep` |
| 4 Pre-computed aggregates | ⚠️ `count: N of T total` when HEY reports a total (e.g. screener). HEY's mailbox lists don't expose totals, so those keep HEY's `summary`/`notice` ("More available") | `shapeEnvelope` |
| 5 Definitive empty states | ✅ ``empty: 0 results for `<command>` ``; home view says "the Imbox is empty" | `shapeEnvelope`, `src/home.js` |
| 6 Structured errors / exit codes / no prompts / fail loud | ✅ TOON errors with a `help` next step per exit code; unknown flags and missing `(required)` flags rejected before HEY runs (exit 2, valid flags listed); suggestions rewritten to `hey-axi …`. ⚠️ idempotency of mutations is HEY's behavior (not re-verified); positional arguments are validated by HEY, not hey-axi | `src/args.js` `validateFlags`, `src/errors.js` |
| 7 Ambient context (session hook) | ✅ `hey-axi setup hooks` for Claude Code, Codex and OpenCode (user or `--project` scope, idempotent, path repair, `--status`, `--remove`) via axi-sdk-js. ⚠️ not directory-scoped (a mailbox isn't per-repo); no session-end capture | `src/hooks.js` |
| 8 Content first (no-arg home view) | ✅ the Imbox's 10 newest threads plus next commands; `status` + fix when HEY is missing or signed out | `src/home.js` |
| 9 Contextual disclosure | ✅ HEY's breadcrumbs → ``help: Run `hey-axi …` ``. ⚠️ HEY also suggests `forward`, which hey-axi refuses without `--allow-send` (the refusal explains) | `shapeEnvelope` |
| 10 Help + `--version` fast path | ✅ `-v`/`-V`/`--version` answered from a leaf module before the CLI loads (latency test); home view shows `bin` + `description`; per-command `--help` has usage, flag descriptions/defaults, examples, notes | `src/hey-axi.js`, `src/version.js` |
| Skill (secondary path) | ✅ SKILL.md's home block generated from the home-view text, `npm run skill:check` in CI. ⚠️ examples use `hey-axi …`, not `npx -y hey-axi …` (not on npm yet) | `scripts/gen-skill.js` |

Remaining risk for an `admitted` verdict: the ⚠️ items above. Also, the per-command default fields for less common lists (screener history, account list, clip list, timetrack list) come from HEY's own table columns and the hey-sdk schema, not from real responses. Missing fields drop out automatically.

### Draft `catalog.yaml` entry

```yaml
  - name: hey-axi
    url: https://github.com/TangentialSolutions/hey-axi
    author: TangentialSolutions
    domain: Email
    description: "HEY email, calendars, todos, habits, journal, and time tracking from the shell - wraps Basecamp's official `hey` CLI with a live Imbox home view and session hook, minimal TOON fields, truncation with `--full`, and send safety: compose and reply are saved as drafts unless `--allow-send`."
```

(Don't add an `admission:` block yourself. Reviewers add it.)

## skills.sh (Vercel's open agent-skills directory)

There's no submission form. Listing happens through install telemetry ([FAQ](https://www.skills.sh/docs/faq): "Skills appear on the leaderboard automatically through anonymous telemetry when users run `npx skills add`").

1. Keep `skills/hey-axi/SKILL.md` in the repo. `skills/` is one of the [CLI's discovery paths](https://github.com/vercel-labs/skills#skill-discovery). It's already verified locally: `npx skills add ./hey-axi --list` → "Found 1 skill: hey-axi".
2. Make the repo public.
3. Install: `npx skills add TangentialSolutions/hey-axi` (add `-g` for user scope, `-a claude-code` to target an agent). Each install from a public repo sends an event, and the skill then appears at `https://skills.sh/TangentialSolutions/hey-axi` and in the rankings. Telemetry is off in CI and with `DISABLE_TELEMETRY=1`/`DO_NOT_TRACK=1` ([CLI docs](https://www.skills.sh/docs/cli), [privacy](https://www.skills.sh/privacy)).
4. Optional badge for the README: `[![skills.sh](https://skills.sh/b/TangentialSolutions/hey-axi)](https://skills.sh/TangentialSolutions/hey-axi)` ([docs](https://www.skills.sh/docs)).

## Other directories

| Directory | How listing works | Source |
|---|---|---|
| GitHub CLI `gh skill` | Searches public repos' `SKILL.md` through code search; `gh skill install TangentialSolutions/hey-axi hey-axi --agent claude-code`. `gh skill publish --dry-run` validates (needs a gh release from 2026-04 or later; preview feature) | [manual](https://cli.github.com/manual/gh_skill), [changelog](https://github.blog/changelog/2026-04-16-manage-agent-skills-with-github-cli/) |
| SkillsMP | Auto-indexes public GitHub repos with `SKILL.md`. The FAQ says to add topic `claude-skills` or `claude-code-skill` and wait for the daily sync; third-party write-ups say it needs ≥2 stars (unverified) | [FAQ](https://skillsmp.com/docs/faq) |
| VoltAgent/awesome-agent-skills | PR to README, titled `Add skill: author/skill-name`, description ≤10 words; **requires real community usage, brand-new skills are rejected** | [CONTRIBUTING](https://github.com/VoltAgent/awesome-agent-skills/blob/main/CONTRIBUTING.md) |
| travisvn/awesome-claude-skills | PR, one item, 1–2 sentence description, prerequisites, license | [CONTRIBUTING](https://github.com/travisvn/awesome-claude-skills/blob/main/CONTRIBUTING.md) |
| Claude Code plugin marketplace | Self-hosted `.claude-plugin/marketplace.json` (not added here). Anthropic also has a directory with its own submission process | [docs](https://code.claude.com/docs/en/plugin-marketplaces) |

Spec reference for the skill format: https://agentskills.io/specification. Validated with `uvx --from skills-ref agentskills validate skills/hey-axi` → "Valid skill".
