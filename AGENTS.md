# AGENTS.md

Guidance for coding agents working on hey-axi.

## What this is
A thin Node (ESM, Node 20+) wrapper around the HEY CLI (`hey`, github.com/basecamp/hey-cli) that renders HEY's JSON envelope as TOON for agents. Its one runtime dependency is `@toon-format/toon`.

## Code map
- `src/hey-axi.js`: the CLI entry point. It parses args, resolves the command, applies policy, picks a run mode, spawns `hey`, and renders the result.
- `src/router.js`: `normalizeCatalog`, `resolveCommand`, `listCommands`. Routing is **data-driven** from `src/manifest.json`; don't add per-command branches.
- `src/manifest.json`: generated snapshot of `hey commands --json`. **Never hand-edit it**; run `npm run refresh-manifest`.
- `src/args.js`: flag-aware scanning (which flags take a value), global value flags, raw output selectors.
- `src/policy.js`: run modes (interactive / stream / raw / json), the send gate, the secret gate, TTY requirements. New special cases go here.
- `src/errors.js`: `heyFailure()` maps a failed run to hey-axi's error shape and keeps HEY's `{ok:false,error,code,hint,meta}`.
- `scripts/refresh-manifest.js`: regenerates the manifest.
- `test/helpers.js`: `makeFakeHey` / `makeFakeHeyScript` (fake binaries that log their arguments) and `runAxi`.

## Rules
1. **Never run the real HEY CLI against a mailbox in tests, and never send email.** Every test uses the fake `hey` through `HEY_BIN`. The only real-`hey` calls anywhere are `hey version` and `hey commands` in `refresh-manifest`.
2. Commands that deliver email must never send without `--allow-send`/`HEY_AXI_ALLOW_SEND=1`. Without it, `compose`/`reply` are auto-staged with `--draft` (and marked `sent: false`, `saved_as: draft`), and `forward`/`draft send`/`bulk-reply send` are refused (`src/policy.js`). Don't loosen this without the owner's sign-off.
3. Forward argv to HEY **in its original order**. Strip only hey-axi's own flags (`AXI_FLAGS`) and the `--json`/`--quiet` that hey-axi adds itself.
4. Output: TOON on stdout for both success and errors (`ok: false`). Raw, stream and interactive modes hand stdout to HEY untouched.
5. Exit codes: pass HEY's through; hey-axi's own refusals use 2; a missing binary uses 127.
6. When HEY adds commands, refresh the manifest. Routing coverage tests (`test/router.test.js`, `test/routing.test.js`) check counts against the manifest, so update the expected numbers on purpose.

## Workflow
- `npm ci && npm test`. Tests must pass before every commit; CI (`.github/workflows/test.yml`) runs them on Node 20 and 22.
- Keep PRs focused, with tests. Never push to `main` directly.
