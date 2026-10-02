#!/usr/bin/env node
// Regenerate src/manifest.json from the installed HEY CLI's own command catalog.
//
//   npm run refresh-manifest              # uses HEY_BIN or `hey` on PATH
//   HEY_BIN=/path/to/hey npm run refresh-manifest
//
// Only `hey version --json` and `hey commands --json` are run. Neither needs a login
// or touches a mailbox.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeCatalog } from "../src/router.js";

const HEY = process.env.HEY_BIN || "hey";
const target = fileURLToPath(new URL("../src/manifest.json", import.meta.url));

function heyJSON(args) {
  const stdout = execFileSync(HEY, [...args, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  const parsed = JSON.parse(stdout);
  return parsed && typeof parsed === "object" && "data" in parsed ? parsed.data : parsed;
}

const version = heyJSON(["version"]);
const catalog = heyJSON(["commands"]);
const manifest = {
  source: "hey commands --json",
  hey_version: version.version,
  hey_commit: version.commit,
  commands: normalizeCatalog(catalog),
};
writeFileSync(target, `${JSON.stringify(manifest, null, 1)}\n`);
process.stdout.write(`wrote ${target} from hey ${version.version} (${manifest.commands.length} top-level commands)\n`);
