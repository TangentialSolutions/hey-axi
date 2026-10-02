#!/usr/bin/env node
// Fake `hey` for the benchmark: replays one captured `hey <argv> --json` response
// (BENCH_REPLAY = path to a capture file). hey-axi always calls hey with `--json`.
import { readFileSync } from "node:fs";

const capture = JSON.parse(readFileSync(process.env.BENCH_REPLAY, "utf8"));
const argv = process.argv.slice(2);
if (argv.at(-1) !== "--json" || argv.slice(0, -1).join(" ") !== capture.argv.join(" ")) {
  process.stderr.write(`replay-hey: unexpected argv ${JSON.stringify(argv)} for capture ${JSON.stringify(capture.argv)}\n`);
  process.exit(99);
}
process.stdout.write(capture.json.stdout);
process.stderr.write(capture.json.stderr);
process.exitCode = capture.json.exit_code;
