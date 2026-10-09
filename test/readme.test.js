// The README states how many commands hey-axi runs and which HEY it covers. Those
// numbers are written by hand, so this test fails as soon as they stop matching the
// manifest (src/manifest.json) and what the router actually resolves. After a manifest
// refresh, update the README (and the expected counts in test/router.test.js) on purpose.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { coverageLabel, listCommands, loadBundledManifest, resolveCommand } from "../src/router.js";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const manifest = loadBundledManifest();
const [, release, branch, shortCommit] = String(manifest.hey_version).match(/^(\d+\.\d+\.\d+)(?:\+([\w.-]+)\.([0-9a-f]{7,}))?$/) || [];

// Paths the router really runs: every runnable path in the manifest, resolved the way
// argv is resolved, that lands on itself and consumes all of its words.
function routedPaths() {
  return listCommands(manifest.commands).filter((node) => {
    const result = resolveCommand(manifest.commands, node.path.split(" "));
    return !result.error && result.path === node.path && result.consumed === node.path.split(" ").length;
  });
}

test("the manifest's HEY version has the shape this test understands", () => {
  assert.ok(release, `unexpected hey_version ${manifest.hey_version}`);
  if (shortCommit) assert.ok(manifest.hey_commit?.startsWith(shortCommit), "hey_version's commit is hey_commit");
});

test("the README's command count matches the manifest and the router", () => {
  const counts = [...readme.matchAll(/\b(\d+) runnable command paths\b/g)].map((match) => Number(match[1]));
  assert.ok(counts.length >= 1, "the README should say how many runnable command paths hey-axi covers");
  const manifestCount = listCommands(manifest.commands).length;
  const routed = routedPaths().length;
  assert.equal(routed, manifestCount, "every runnable manifest path should route to itself");
  for (const count of counts) assert.equal(count, routed, `README says ${count} runnable command paths; the manifest and router have ${routed}`);
  // Any other "N commands"-style total in the README must agree too.
  for (const [, count] of readme.matchAll(/\b(\d{3}) (?:commands|command paths|runnable paths)\b/g)) assert.equal(Number(count), routed, `README mentions ${count} commands`);
});

test("the README names the HEY version the manifest was built from", () => {
  assert.match(readme, new RegExp(`every command in HEY CLI v${release.replace(/\./g, "\\.")}\\b`), `README should say it covers HEY CLI v${release}`);
  for (const [, version] of readme.matchAll(/HEY CLI v(\d+\.\d+\.\d+)/g)) assert.equal(version, release, `README mentions HEY CLI v${version}; the manifest builds on v${release}`);
  for (const [, label] of readme.matchAll(/`hey_version` reads `([^`]+)`/g)) assert.equal(label, manifest.hey_version);
});

test("the README names the HEY commit and date the manifest was built from", () => {
  // Every basecamp/hey-cli commit link and every short sha in backticks is the manifest's.
  const links = [...readme.matchAll(/github\.com\/basecamp\/hey-cli\/commit\/([0-9a-f]{7,40})/g)].map((match) => match[1]);
  const shas = [...readme.matchAll(/`([0-9a-f]{7,40})`/g)].map((match) => match[1]).filter((sha) => /\d/.test(sha) && /[a-f]/.test(sha));
  const dates = [...readme.matchAll(/(?:as of|commit `[0-9a-f]{7,40}`,) (\d{4}-\d{2}-\d{2})/g)].map((match) => match[1]);
  if (!branch) {
    // A release snapshot: the README shouldn't still claim an unreleased commit.
    assert.deepEqual(links, [], "README links an unreleased HEY commit but the manifest is a release");
    assert.doesNotMatch(readme, /unreleased `main` branch/, "README still says it covers HEY's unreleased main branch");
    return;
  }
  assert.ok(links.length >= 1, "README should link the HEY commit it covers");
  for (const link of links) assert.equal(link, link.length === 40 ? manifest.hey_commit : manifest.hey_commit.slice(0, link.length), `README links hey-cli commit ${link}; the manifest is ${manifest.hey_commit}`);
  assert.ok(shas.length >= 1, "README should name the short commit");
  for (const sha of shas) assert.ok(manifest.hey_commit.startsWith(sha), `README names commit ${sha}; the manifest is ${manifest.hey_commit}`);
  assert.ok(dates.length >= 1, "README should say the date of the HEY commit it covers");
  for (const date of dates) assert.equal(date, manifest.hey_commit_date, `README says ${date}; the manifest's commit is from ${manifest.hey_commit_date}`);
  assert.match(readme, new RegExp(`unreleased \`${branch}\` branch`), `README should say it covers HEY's unreleased ${branch} branch`);
  // The README's wording agrees with the label --help and the skill print.
  assert.match(coverageLabel(manifest), new RegExp(`as of ${manifest.hey_commit_date} \\(commit ${shortCommit}, unreleased\\)`));
});

test("the README badges: skills.sh, npm version and CI status, side by side", () => {
  const line = readme.split("\n").find((text) => text.includes("skills.sh/b/TangentialSolutions/hey-axi"));
  assert.ok(line, "skills.sh badge");
  assert.match(line, /\[!\[npm\]\(https:\/\/img\.shields\.io\/npm\/v\/hey-axi\.svg\)\]\(https:\/\/www\.npmjs\.com\/package\/hey-axi\)/);
  assert.match(line, /\[!\[test\]\(https:\/\/github\.com\/TangentialSolutions\/hey-axi\/actions\/workflows\/test\.yml\/badge\.svg\?branch=main\)\]\(https:\/\/github\.com\/TangentialSolutions\/hey-axi\/actions\/workflows\/test\.yml\)/);
  // The CI badge points at a workflow that exists.
  readFileSync(new URL("../.github/workflows/test.yml", import.meta.url), "utf8");
});
