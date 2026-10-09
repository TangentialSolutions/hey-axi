// `screener clear` trashes everything waiting in the Screener (HEY main), with no
// confirmation from HEY. hey-axi refuses it unless --allow-destructive (or
// HEY_AXI_ALLOW_DESTRUCTIVE=1) is passed, the same way --allow-send and --allow-secret
// gate their commands. Every test uses the fake HEY.
import test from "node:test";
import assert from "node:assert/strict";
import { makeFakeHey, runAxi } from "./helpers.js";
import { checkPolicy, destructiveCommands } from "../src/policy.js";
import { stripAxiFlags } from "../src/args.js";

const noOptIn = { HEY_AXI_ALLOW_SEND: "", HEY_AXI_ALLOW_SECRETS: "", HEY_AXI_ALLOW_DESTRUCTIVE: "" };
const tty = { stdin: true, stdout: true };
const CLEARED = '{"ok":true,"data":{"cleared":true},"summary":"Screener cleared"}';

test("screener clear is the one destructive command, refused by policy without the opt-in", () => {
  assert.deepEqual(destructiveCommands(), ["screener clear"]);
  const refusal = checkPolicy("screener clear", new Set(), {}, tty);
  assert.equal(refusal.error, "destructive command blocked");
  assert.match(refusal.reason, /everything waiting in the Screener to Trash/);
  assert.match(refusal.reason, /nothing was changed/);
  assert.match(refusal.hint, /--allow-destructive/);
  assert.equal(checkPolicy("screener clear", new Set(["--allow-destructive"]), {}, tty), null);
  assert.equal(checkPolicy("screener clear", new Set(), { HEY_AXI_ALLOW_DESTRUCTIVE: "1" }, tty), null);
  assert.notEqual(checkPolicy("screener clear", new Set(), { HEY_AXI_ALLOW_DESTRUCTIVE: "0" }, tty), null);
  // The neighbours that act on one sender are not gated.
  for (const path of ["screener approve", "screener deny", "screener list", "trash"]) assert.equal(checkPolicy(path, new Set(), {}, tty), null, path);
  // Other opt-ins don't unlock it.
  assert.notEqual(checkPolicy("screener clear", new Set(["--allow-send", "--allow-secret"]), { HEY_AXI_ALLOW_SEND: "1", HEY_AXI_ALLOW_SECRETS: "1" }, tty), null);
});

test("without --allow-destructive, screener clear is refused (exit 2) with what it would do and how to proceed; HEY never runs", async () => {
  const fake = await makeFakeHey({ stdout: CLEARED });
  for (const line of [["screener", "clear"], ["screener", "clear", "--json"], ["screener", "clear", "--quiet"], ["screener", "clear", "--ids-only"], ["--account", "3", "screener", "clear"]]) {
    const result = await runAxi(line, { fake, env: noOptIn });
    assert.equal(result.code, 2, line.join(" "));
    assert.match(result.stdout, /^ok: false\nkind: usage\nerror: destructive command blocked\ncommand: screener clear\n/, line.join(" "));
    assert.match(result.stdout, /moves everything waiting in the Screener to Trash \(the whole queue for the account, every sender/);
    assert.match(result.stdout, /nothing was changed/);
    assert.match(result.stdout, /hey-axi screener list/);
    assert.match(result.stdout, /confirm with the user, then pass --allow-destructive \(or set HEY_AXI_ALLOW_DESTRUCTIVE=1\)/);
  }
  const scoped = await runAxi(["--account", "3", "screener", "clear"], { fake, env: noOptIn });
  assert.match(scoped.stdout, /hey-axi screener list --account 3/);
  assert.deepEqual(await fake.calls(), []);
  await fake.cleanup();
});

test("--allow-destructive runs it, and is not forwarded to HEY", async () => {
  const fake = await makeFakeHey({ stdout: CLEARED });
  const result = await runAxi(["screener", "clear", "--allow-destructive"], { fake, env: noOptIn });
  assert.equal(result.code, 0, result.stdout);
  assert.match(result.stdout, /Screener cleared/);
  const flagFirst = await runAxi(["--allow-destructive", "--account", "2", "screener", "clear"], { fake, env: noOptIn });
  assert.equal(flagFirst.code, 0, flagFirst.stdout);
  assert.deepEqual(await fake.calls(), ["screener clear --json", "--account 2 screener clear --json"]);
  assert.deepEqual(stripAxiFlags(["screener", "clear", "--allow-destructive"]), ["screener", "clear"]);
  await fake.cleanup();
});

test("HEY_AXI_ALLOW_DESTRUCTIVE=1 opts in for the whole process", async () => {
  const fake = await makeFakeHey({ stdout: CLEARED });
  assert.equal((await runAxi(["screener", "clear"], { fake, env: { ...noOptIn, HEY_AXI_ALLOW_DESTRUCTIVE: "1" } })).code, 0);
  assert.equal((await runAxi(["screener", "clear"], { fake, env: { ...noOptIn, HEY_AXI_ALLOW_DESTRUCTIVE: "true" } })).code, 0);
  assert.deepEqual(await fake.calls(), ["screener clear --json", "screener clear --json"]);
  await fake.cleanup();
});

test("--allow-destructive is a switch: --allow-destructive=false is refused, not guessed at", async () => {
  const fake = await makeFakeHey({ stdout: CLEARED });
  const result = await runAxi(["screener", "clear", "--allow-destructive=false"], { fake, env: noOptIn });
  assert.equal(result.code, 2);
  assert.match(result.stdout, /--allow-destructive is a switch and takes no value/);
  assert.deepEqual(await fake.calls(), []);
  await fake.cleanup();
});

test("an already-empty Screener with the opt-in is a no-op, a real failure stays an error", async () => {
  const empty = await makeFakeHey({ stdout: '{"ok":false,"error":"Screener already cleared","code":"conflict"}', exitCode: 1 });
  const noop = await runAxi(["screener", "clear", "--allow-destructive"], { fake: empty, env: noOptIn });
  assert.equal(noop.code, 0, noop.stdout);
  assert.match(noop.stdout, /noop: true/);
  await empty.cleanup();
  const broken = await makeFakeHey({ stdout: '{"ok":false,"error":"Not signed in","code":"auth"}', exitCode: 3 });
  const failed = await runAxi(["screener", "clear", "--allow-destructive"], { fake: broken, env: noOptIn });
  assert.equal(failed.code, 1);
  assert.match(failed.stdout, /kind: auth/);
  await broken.cleanup();
});

test("help explains the gate offline: per-command help, examples and top-level safety section", async () => {
  const fake = await makeFakeHey();
  const help = await runAxi(["screener", "clear", "--help"], { fake, env: noOptIn });
  assert.equal(help.code, 0);
  assert.match(help.stdout, /--allow-destructive {2}really run it \(default false: refused, nothing is changed\)/);
  assert.match(help.stdout, /destructive command blocked: this command moves everything waiting in the Screener to Trash/);
  assert.match(help.stdout, /examples:\n {2}hey-axi screener clear --allow-destructive\n/);
  const top = await runAxi(["--help"], { fake, env: noOptIn });
  assert.match(top.stdout, /screener clear \(trashes everything waiting in the Screener\) needs --allow-destructive \//);
  // Only the destructive command advertises the flag.
  const deny = await runAxi(["screener", "deny", "--help"], { fake, env: noOptIn });
  assert.doesNotMatch(deny.stdout, /--allow-destructive/);
  // An unknown flag error lists it among the always-allowed flags.
  const unknown = await runAxi(["screener", "clear", "--force"], { fake, env: noOptIn });
  assert.equal(unknown.code, 2);
  assert.match(unknown.stdout, /--allow-destructive/);
  assert.deepEqual(await fake.calls(), []);
  await fake.cleanup();
});
