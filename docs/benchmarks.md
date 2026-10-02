# Token benchmark: HEY CLI vs hey-axi

How many tokens does an agent spend reading the same HEY result through each output path?

> **All numbers below come from SYNTHETIC data.** No real account or mailbox was used. The `hey` binary is the real HEY CLI v1.7.0, but it was pointed at a local mock API serving invented, schema-shaped responses. See [Methodology](#methodology) and [Limitations](#limitations), and [rerun it on your own mailbox](#rerun-on-your-own-mailbox-read-only) for real numbers.

## Results

<!-- bench:results:start -->
Measured on **synthetic** captures from hey 1.7.0, tokenizers from js-tiktoken. Negative % = hey-axi output is larger.

### o200k_base (GPT-4o / GPT-4.1 / o-series)

| Command | `hey --json` | `hey --styled` | hey-axi `--full` | **hey-axi (default)** | hey-axi `--json` | default vs `hey --json` | default vs `--full` | default vs `--styled` |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| box list | 768 | 62 | 503 | **116** | 132 | 84.9% | 76.9% | -87.1% |
| box view imbox | 20,598 | 857 | 15,591 | **689** | 853 | 96.7% | 95.6% | 19.6% |
| thread read (long thread) | 2,811 | 1,506 | 2,409 | **1,189** | 1,230 | 57.7% | 50.6% | 21.0% |
| label list | 379 | 58 | 214 | **116** | 125 | 69.4% | 45.8% | -100.0% |
| screener list | 784 | 162 | 465 | **258** | 313 | 67.1% | 44.5% | -59.3% |
| event week | 5,573 | 471 | 4,629 | **682** | 782 | 87.8% | 85.3% | -44.8% |
| todo list | 1,684 | 136 | 1,373 | **280** | 310 | 83.4% | 79.6% | -105.9% |
| search (paged) | 6,634 | 864 | 5,024 | **645** | 775 | 90.3% | 87.2% | 25.3% |
| error (thread not found) | 25 | 6 | 48 | **48** | 50 | -92.0% | 0.0% | -700.0% |
| **Total** | **39,256** | **4,122** | **30,256** | **4,023** | **4,570** | **89.8%** | **86.7%** | **2.4%** |

### cl100k_base (GPT-4 / GPT-3.5)

| Command | `hey --json` | `hey --styled` | hey-axi `--full` | **hey-axi (default)** | hey-axi `--json` | default vs `hey --json` | default vs `--full` | default vs `--styled` |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| box list | 761 | 62 | 497 | **117** | 132 | 84.6% | 76.5% | -88.7% |
| box view imbox | 20,563 | 862 | 15,565 | **687** | 860 | 96.7% | 95.6% | 20.3% |
| thread read (long thread) | 2,852 | 1,559 | 2,454 | **1,212** | 1,248 | 57.5% | 50.6% | 22.3% |
| label list | 380 | 58 | 214 | **117** | 126 | 69.2% | 45.3% | -101.7% |
| screener list | 787 | 163 | 468 | **261** | 314 | 66.8% | 44.2% | -60.1% |
| event week | 5,552 | 471 | 4,633 | **685** | 786 | 87.7% | 85.2% | -45.4% |
| todo list | 1,685 | 136 | 1,373 | **283** | 312 | 83.2% | 79.4% | -108.1% |
| search (paged) | 6,647 | 869 | 5,031 | **647** | 775 | 90.3% | 87.1% | 25.5% |
| error (thread not found) | 25 | 6 | 49 | **49** | 51 | -96.0% | 0.0% | -716.7% |
| **Total** | **39,252** | **4,186** | **30,284** | **4,058** | **4,604** | **89.7%** | **86.6%** | **3.1%** |
<!-- bench:results:end -->

### Before and after the AXI defaults (hey-axi 0.1.0 → 0.2.0), o200k_base

| Output | Total tokens | vs `hey --json` |
|---|---:|---:|
| `hey --json` | 39,256 | — |
| `hey --styled` (human table) | 4,122 | 89.5% |
| hey-axi 0.1.0 default (TOON of the full envelope) | 30,229 | 23.0% |
| hey-axi 0.1.0 `--json` | 29,445 | 25.0% |
| **hey-axi 0.2.0 default** | **4,471** | **88.6%** |
| hey-axi 0.2.0 `--json` | 5,206 | 86.7% |
| hey-axi 0.2.0 `--full` (old default + help on errors) | 30,257 | 22.9% |

The 0.1.0 rows were measured on the same checked-in captures before this change. `--full` reproduces the 0.1.0 default exactly, except that errors now carry a `help` line (21 → 49 tokens on the error case).

### What the numbers say

- **Field selection is where the savings come from.** hey-axi 0.2.0's default output is about **89% smaller than `hey --json`** and **85% smaller than hey-axi 0.1.0**. Lists keep a few columns (e.g. `box view`: `id, topic_id, from, subject, seen, at`) instead of every nested contact, URL and avatar. `box view imbox` drops from 15,591 to 1,059 tokens.
- **It's now in the same range as HEY's human table output** (4,471 vs 4,122 in total) while staying structured and complete per row: full subjects, full IDs, ISO dates. `--styled` truncates subjects and summaries to about 40–60 characters.
- **Detail views shrink less, by design.** `thread read` keeps each message body up to 1000 characters and marks the rest (`… (truncated, 1500 chars total)`, plus a `--full` hint). It drops URLs, avatars and the duplicated `summary`, for a 51% saving over 0.1.0.
- **Errors grow slightly** (21 → 49 tokens) because they now include an actionable `help` line. AXI prefers that over a bare error that costs a follow-up call.
- `--json` prints the same shaped result. It's a bit larger than TOON for uniform tables (TOON writes each column name once).

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
   - It counts tokens in five outputs: `hey --json` (as printed: pretty JSON), `hey --styled` (ANSI stripped), hey-axi `--full` (HEY's complete envelope as TOON, i.e. the 0.1.0 default), hey-axi's default output, and hey-axi `--json` (compact).
   - Tokenizers: OpenAI `o200k_base` and `cl100k_base` via `js-tiktoken`, pinned in `package-lock.json`.
   - For the error case, HEY's JSON envelope goes to stderr, so that's what is counted.

Commands: `box list`, `box view imbox`, `thread read <id>` (4-message thread with long HTML bodies), `label list`, `screener list`, `event week`, `todo list`, `search invoice` (one page), and an error (`thread read` on a missing thread).

## Limitations

- **Synthetic data.** Schemas fill every documented field. Real responses may omit optional fields, use different string lengths, or carry more items per page. Field-heavy views (`box view`, `search`) are the most likely to differ. Treat absolute numbers as indicative and the *ratios* as the finding.
- **No Anthropic (Claude) tokenizer.** There is no reliable offline tokenizer for Claude 3+ models. `@anthropic-ai/tokenizer` on npm is the legacy Claude 2 tokenizer and Anthropic says it isn't accurate for current models. For exact Claude counts, send the outputs to Anthropic's `messages/count_tokens` API yourself (that sends the text to Anthropic, so only do it with synthetic or non-sensitive captures). Claude token counts for the same text can differ noticeably from o200k/cl100k, so treat these as a proxy; the *relative* differences between output formats are what carry over.
- `--styled` output was captured with stdout not attached to a terminal, so table widths use HEY's default rather than your terminal width.
- Only one page of each listing is measured. hey-axi doesn't change how many items HEY returns.
- Truncation savings depend on body length. The synthetic thread has 1,500-character bodies, so real long emails save more and short ones save nothing.

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
