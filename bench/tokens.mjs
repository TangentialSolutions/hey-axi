#!/usr/bin/env node
// Token benchmark: HEY CLI output vs hey-axi output, counted with real tokenizers.
//
//   npm run bench:tokens                     # synthetic captures (checked in)
//   npm run bench:tokens -- --real           # your captures from `npm run bench:capture -- --real`
//   npm run bench:tokens -- --write          # also rewrite the results block in docs/benchmarks.md
//   npm run bench:tokens -- --json           # machine-readable results
//
// For each captured command it measures:
//   (a) `hey … --json`    raw envelope as HEY prints it (pretty-printed JSON)
//   (b) `hey … --styled`  HEY's human/terminal output (ANSI stripped)
//   (c) `hey-axi …`       default TOON output
//   (d) `hey-axi … --json` compact JSON envelope
// hey-axi runs for real (src/hey-axi.js) against a replay of the captured HEY response.
// For error commands, HEY writes its envelope to stderr; that's what gets counted.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getEncoding } from "js-tiktoken";

const args = process.argv.slice(2);
const real = args.includes("--real");
const root = new URL("../", import.meta.url);
const captureDir = fileURLToPath(new URL(`bench/captures/${real ? "real" : "synthetic"}/`, root));
const replay = fileURLToPath(new URL("bench/lib/replay-hey.mjs", root));
const axi = fileURLToPath(new URL("src/hey-axi.js", root));
const ENCODINGS = ["o200k_base", "cl100k_base"];
const encoders = Object.fromEntries(ENCODINGS.map((name) => [name, getEncoding(name)]));

const stripAnsi = (text) => text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");

function runAxi(capture, file, extra = []) {
  try {
    return execFileSync(process.execPath, [axi, ...capture.argv, ...extra], {
      env: { ...process.env, HEY_BIN: replay, BENCH_REPLAY: file, HEY_AXI_ALLOW_SEND: "" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (typeof error.stdout === "string" && error.stdout) return error.stdout; // error commands exit non-zero
    throw error;
  }
}

const ORDER = ["box list", "box view imbox", "thread read (long thread)", "label list", "screener list", "event week", "todo list", "search (paged)", "error (thread not found)"];
const files = readdirSync(captureDir).filter((name) => name.endsWith(".json"));
if (!files.length) {
  console.error(`no captures in ${captureDir}; run npm run bench:capture${real ? " -- --real" : ""}`);
  process.exit(2);
}
const rows = files.map((name) => {
  const file = `${captureDir}${name}`;
  const capture = JSON.parse(readFileSync(file, "utf8"));
  const heyJSON = capture.json.exit_code === 0 ? capture.json.stdout : capture.json.stderr;
  const styled = stripAnsi(capture.styled.exit_code === 0 ? capture.styled.stdout : capture.styled.stdout + capture.styled.stderr);
  const outputs = { hey_json: heyJSON, hey_styled: styled, axi_toon: runAxi(capture, file), axi_json: runAxi(capture, file, ["--json"]) };
  const tokens = Object.fromEntries(ENCODINGS.map((encoding) => [encoding, Object.fromEntries(Object.entries(outputs).map(([key, text]) => [key, encoders[encoding].encode(text).length]))]));
  return { command: capture.command, argv: capture.argv, synthetic: capture.synthetic, hey_version: capture.hey_version, bytes: Object.fromEntries(Object.entries(outputs).map(([key, text]) => [key, Buffer.byteLength(text)])), tokens };
}).sort((a, b) => ORDER.indexOf(a.command) - ORDER.indexOf(b.command));

const pct = (from, to) => (from ? `${(((from - to) / from) * 100).toFixed(1)}%` : "n/a");
const fmt = (n) => n.toLocaleString("en-US");

function table(encoding) {
  const lines = [
    `| Command | \`hey --json\` | \`hey --styled\` | **hey-axi (TOON)** | hey-axi \`--json\` | TOON vs \`hey --json\` | TOON vs \`--styled\` |`,
    "|---|---:|---:|---:|---:|---:|---:|",
  ];
  const total = { hey_json: 0, hey_styled: 0, axi_toon: 0, axi_json: 0 };
  for (const row of rows) {
    const t = row.tokens[encoding];
    for (const key of Object.keys(total)) total[key] += t[key];
    lines.push(`| ${row.command} | ${fmt(t.hey_json)} | ${fmt(t.hey_styled)} | **${fmt(t.axi_toon)}** | ${fmt(t.axi_json)} | ${pct(t.hey_json, t.axi_toon)} | ${pct(t.hey_styled, t.axi_toon)} |`);
  }
  lines.push(`| **Total** | **${fmt(total.hey_json)}** | **${fmt(total.hey_styled)}** | **${fmt(total.axi_toon)}** | **${fmt(total.axi_json)}** | **${pct(total.hey_json, total.axi_toon)}** | **${pct(total.hey_styled, total.axi_toon)}** |`);
  return lines.join("\n");
}

const header = `Measured on ${real ? "**real** captures" : "**synthetic** captures"} from hey ${rows[0].hey_version}, tokenizers from js-tiktoken. Negative % = hey-axi output is larger.`;
const markdown = [header, "", "### o200k_base (GPT-4o / GPT-4.1 / o-series)", "", table("o200k_base"), "", "### cl100k_base (GPT-4 / GPT-3.5)", "", table("cl100k_base")].join("\n");

if (args.includes("--json")) process.stdout.write(`${JSON.stringify({ real, rows }, null, 2)}\n`);
else process.stdout.write(`${markdown}\n`);

if (args.includes("--write")) {
  if (real) {
    console.error("refusing to --write real-mailbox numbers into the repo docs; copy them by hand if you want to share them");
    process.exit(2);
  }
  const docPath = fileURLToPath(new URL("docs/benchmarks.md", root));
  const doc = readFileSync(docPath, "utf8");
  const start = "<!-- bench:results:start -->";
  const end = "<!-- bench:results:end -->";
  const updated = doc.replace(new RegExp(`${start}[\\s\\S]*?${end}`), `${start}\n${markdown}\n${end}`);
  writeFileSync(docPath, updated);
  console.error(`updated ${docPath}`);
}
