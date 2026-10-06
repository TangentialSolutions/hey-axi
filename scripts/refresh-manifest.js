#!/usr/bin/env node
// Regenerate src/manifest.json from a HEY CLI binary's own command catalog.
//
//   npm run refresh-manifest                    # uses HEY_BIN or `hey` on PATH (a release)
//   HEY_BIN=/path/to/hey npm run refresh-manifest
//   npm run manifest:main                       # build HEY from basecamp/hey-cli main and use that
//                                               # (scripts/check-drift.js --write)
//
// A HEY built from source reports version "dev"; label it with
//   HEY_VERSION_LABEL=1.7.0+main.8bf9310 HEY_COMMIT=<sha> HEY_COMMIT_DATE=2026-10-03 HEY_SOURCE="..."
//
// Only `hey version --json`, `hey commands --json` and `hey <command> --help` are run.
// None of them needs a login or touches a mailbox.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateManifest, serialize } from "./manifest-lib.js";

const HEY = process.env.HEY_BIN || "hey";
const target = fileURLToPath(new URL("../src/manifest.json", import.meta.url));

const label = {
  version: process.env.HEY_VERSION_LABEL,
  commit: process.env.HEY_COMMIT,
  commit_date: process.env.HEY_COMMIT_DATE,
  source: process.env.HEY_SOURCE,
};
const manifest = generateManifest(HEY, { label });
writeFileSync(target, serialize(manifest));
process.stdout.write(`wrote ${target} from hey ${manifest.hey_version} (${manifest.commands.length} top-level commands)\n`);
