#!/usr/bin/env node
// Entry point. `-v`, `-V` and `--version` are answered before the CLI graph loads
// (AXI "--version fast path"); everything else goes to src/cli.js.
import { tryFastPath } from "axi-sdk-js/fast-path";
import { VERSION } from "./version.js";

if (!tryFastPath(process.argv.slice(2), { version: VERSION })) {
  const { main } = await import("./cli.js");
  await main();
}
