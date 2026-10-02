# Token benchmark: HEY CLI vs hey-axi

How many tokens does an agent spend reading the same HEY result through each output path?

> **All numbers below come from SYNTHETIC data.** No real account or mailbox was used. The `hey` binary is the real HEY CLI v1.7.0, but it was pointed at a local mock API serving invented, schema-shaped responses. See [Methodology](#methodology) and [Limitations](#limitations), and [rerun it on your own mailbox](#rerun-on-your-own-mailbox-read-only) for real numbers.

## Results

<!-- bench:results:start -->
Measured on **synthetic** captures from hey 1.7.0, tokenizers from js-tiktoken. Negative % = hey-axi output is larger.

### o200k_base (GPT-4o / GPT-4.1 / o-series)

| Command | `hey --json` | `hey --styled` | **hey-axi (TOON)** | hey-axi `--json` | TOON vs `hey --json` | TOON vs `--styled` |
|---|---:|---:|---:|---:|---:|---:|
| box list | 768 | 62 | **503** | 588 | 34.5% | -711.3% |
| box view imbox | 20,598 | 857 | **15,591** | 15,310 | 24.3% | -1719.3% |
| thread read (long thread) | 2,811 | 1,506 | **2,409** | 2,308 | 14.3% | -60.0% |
| label list | 379 | 58 | **214** | 246 | 43.5% | -269.0% |
| screener list | 784 | 162 | **465** | 553 | 40.7% | -187.0% |
| event week | 5,573 | 471 | **4,629** | 4,234 | 16.9% | -882.8% |
| todo list | 1,684 | 136 | **1,373** | 1,226 | 18.5% | -909.6% |
| search (paged) | 6,634 | 864 | **5,024** | 4,959 | 24.3% | -481.5% |
| error (thread not found) | 25 | 6 | **21** | 21 | 16.0% | -250.0% |
| **Total** | **39,256** | **4,122** | **30,229** | **29,445** | **23.0%** | **-633.4%** |

### cl100k_base (GPT-4 / GPT-3.5)

| Command | `hey --json` | `hey --styled` | **hey-axi (TOON)** | hey-axi `--json` | TOON vs `hey --json` | TOON vs `--styled` |
|---|---:|---:|---:|---:|---:|---:|
| box list | 761 | 62 | **497** | 580 | 34.7% | -701.6% |
| box view imbox | 20,563 | 862 | **15,565** | 15,192 | 24.3% | -1705.7% |
| thread read (long thread) | 2,852 | 1,559 | **2,454** | 2,327 | 14.0% | -57.4% |
| label list | 380 | 58 | **214** | 245 | 43.7% | -269.0% |
| screener list | 787 | 163 | **468** | 553 | 40.5% | -187.1% |
| event week | 5,552 | 471 | **4,633** | 4,167 | 16.6% | -883.7% |
| todo list | 1,685 | 136 | **1,373** | 1,217 | 18.5% | -909.6% |
| search (paged) | 6,647 | 869 | **5,031** | 4,929 | 24.3% | -478.9% |
| error (thread not found) | 25 | 6 | **21** | 21 | 16.0% | -250.0% |
| **Total** | **39,252** | **4,186** | **30,256** | **29,231** | **22.9%** | **-622.8%** |
<!-- bench:results:end -->

### What the numbers say

- **hey-axi's TOON output is about 23% smaller than `hey --json`** across these commands. Most of that is dropping the pretty-printed whitespace and repeated keys. Flat, uniform lists (labels, screener, box list) shrink most (35–44%).
- **On deeply nested payloads, TOON is about the same size as compact JSON, and sometimes a little bigger.** Examples: postings with nested contacts (`box view`), calendar recordings (`event week`, `todo list`), thread entries. TOON only folds an array into a table when its items share one flat shape. Nested objects fall back to indented key/value lines, and the indentation costs tokens.
- **HEY's human output (`--styled`) is roughly 5–24× smaller than any JSON form for listings.** That's because it shows a handful of columns rather than every field. It keeps IDs, but truncates long fields (Imbox summaries are cut at about 60 characters), drops nested data like recipients, and is a display format rather than a stable thing to parse. hey-axi doesn't try to beat it today.
- **The biggest remaining win is field selection, not encoding.** A hey-axi mode that keeps only the fields an agent usually needs (id, subject/title, sender, date, seen) would likely land close to `--styled` sizes while staying structured. Until then, HEY's own `--jq` (passed through by hey-axi) can do the same per call, e.g. `hey-axi box view imbox --jq '.data.postings[] | {id, name, summary}'`.

## Methodology

1. **API fixtures (synthetic)** come from `bench/generate-api-fixtures.mjs`, which reads basecamp/hey-sdk's `openapi.json` at tag `go/v0.31.1` (the SDK version HEY CLI v1.7.0 is built against).
   - Every response is generated from the spec's schema for that endpoint.
   - Values are invented: realistic subjects, names, `*.example` addresses, ISO timestamps, a long multi-paragraph HTML email for the thread.
   - A few per-endpoint "shapers" add the structure the CLI interprets: real box kinds, the "Labels" navigation group, calendar recordings keyed by `Calendar::Event` / `Calendar::Todo` with type-appropriate fields, and a page of 25 Imbox postings and 20 search matches.
   - The output is checked in under `bench/api-fixtures/` (`index.json` marks it `synthetic: true`).
2. **Captures** come from `bench/capture.mjs`.
   - It starts `bench/lib/mock-hey-api.mjs`, a local server that answers GET only and returns 405 for everything else.
   - It runs the **real `hey` binary** with `HEY_BASE_URL` pointing at the mock, a dummy `HEY_TOKEN`, and a throwaway `HOME`.
   - For each command it records `hey <cmd> --json` (stdout, stderr, exit code) and `hey <cmd> --styled`. These are HEY's actual formatting code paths, not hand-written approximations. Checked in under `bench/captures/synthetic/`.
3. **Measurement** comes from `bench/tokens.mjs`.
   - It runs the real `src/hey-axi.js` against `bench/lib/replay-hey.mjs`, which replays the captured `--json` response (hey-axi always calls `hey … --json`).
   - It counts tokens in four outputs: `hey --json` (as printed: pretty JSON), `hey --styled` (ANSI stripped), hey-axi default TOON, and hey-axi `--json` (compact).
   - Tokenizers: OpenAI `o200k_base` and `cl100k_base` via `js-tiktoken`, pinned in `package-lock.json`.
   - For the error case, HEY's JSON envelope goes to stderr, so that's what is counted.

Commands: `box list`, `box view imbox`, `thread read <id>` (4-message thread with long HTML bodies), `label list`, `screener list`, `event week`, `todo list`, `search invoice` (one page), and an error (`thread read` on a missing thread).

## Limitations

- **Synthetic data.** Schemas fill every documented field. Real responses may omit optional fields, use different string lengths, or carry more items per page. Field-heavy views (`box view`, `search`) are the most likely to differ. Treat absolute numbers as indicative and the *ratios* as the finding.
- **No Anthropic (Claude) tokenizer.** There is no reliable offline tokenizer for Claude 3+ models. `@anthropic-ai/tokenizer` on npm is the legacy Claude 2 tokenizer and Anthropic says it isn't accurate for current models. For exact Claude counts, send the outputs to Anthropic's `messages/count_tokens` API yourself (that sends the text to Anthropic, so only do it with synthetic or non-sensitive captures). Claude token counts for the same text can differ noticeably from o200k/cl100k, so treat these as a proxy; the *relative* differences between output formats are what carry over.
- `--styled` output was captured with stdout not attached to a terminal, so table widths use HEY's default rather than your terminal width.
- Only one page of each listing is measured. hey-axi doesn't change how many items HEY returns.

## Reproduce

```bash
npm ci
npm run bench:tokens                         # recount from the checked-in captures (no hey needed)
npm run bench:tokens -- --write              # …and refresh the table above
HEY_BIN=/path/to/hey npm run bench:capture   # re-capture with a real hey binary vs the mock API
HEY_SDK_OPENAPI=/path/to/hey-sdk/openapi.json npm run bench:fixtures   # regenerate the synthetic API fixtures
```

## Rerun on your own mailbox (read-only)

On a machine where `hey` is logged in (e.g. your Mac):

```bash
npm run bench:capture -- --real      # runs ONLY: box list, box view imbox, thread read <first Imbox thread>,
                                     #   label list, screener list, event week, todo list, search, and one
                                     #   not-found thread read. Nothing is sent, moved, or marked seen.
npm run bench:tokens -- --real       # prints the same tables for your data
```

- Set `BENCH_THREAD_ID=<id>` to pick a specific (ideally long) thread, and `BENCH_SEARCH_QUERY=...` to change the search.
- Captures go to `bench/captures/real/`, which is **gitignored** because it contains your email. `--write` refuses to put real numbers into this file, so copy the table by hand if you want to share it.
- `capture.mjs` refuses any command that isn't on the read-only allowlist in `bench/commands.mjs`.
