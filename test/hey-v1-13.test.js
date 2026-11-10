// What HEY added to the command surface between the previous pin (7a30c73 / v1.10.1 +
// thread comment) and HEY CLI v1.13.1 (d8cb8eb): `--mcp` on auth login/logout (and the
// login/logout aliases), and `reply --from`. Fake HEY only.
import test from "node:test";
import assert from "node:assert/strict";
import { makeFakeHey, runAxi } from "./helpers.js";
import { loadBundledManifest, resolveCommand, coverageLabel } from "../src/router.js";
import { userOnly } from "../src/policy.js";

const manifest = loadBundledManifest();

function flag(path, name) {
  const { node, error } = resolveCommand(manifest.commands, path.split(" "));
  assert.equal(error, undefined, path);
  return (node.flags || []).find((entry) => entry.name === name);
}

test("the manifest pins HEY CLI v1.13.1 and names the new mcp and reply flags", () => {
  assert.equal(manifest.hey_version, "1.13.1");
  assert.equal(coverageLabel(manifest), "v1.13.1");
  for (const path of ["auth login", "login"]) {
    const mcp = flag(path, "mcp");
    assert.equal(mcp.default, "false", path);
    assert.equal(mcp.value, undefined, `${path} --mcp is a boolean`);
    assert.match(mcp.desc, /Sign in hey mcp with its own credential/);
  }
  for (const path of ["auth logout", "logout"]) {
    const mcp = flag(path, "mcp");
    assert.equal(mcp.default, "false", path);
    assert.match(mcp.desc, /Sign hey mcp out/);
  }
  const from = flag("reply", "from");
  assert.equal(from.value, true);
  assert.equal(from.type, "string");
  assert.match(from.desc, /Configured sender email or ID within the thread's account/);
});

test("auth login --mcp and login --mcp still need --interactive (they are not --token)", () => {
  const tty = { stdin: true, stdout: true };
  for (const path of ["auth login", "login"]) {
    assert.match(userOnly(path, new Set(["--mcp"]), tty).error, /needs the user/, path);
    assert.match(userOnly(path, new Set(["--mcp"]), tty).hint, /--interactive/, path);
    // --token still skips the person-only rule; --mcp does not.
    assert.equal(userOnly(path, new Set(["--token"]), { stdin: false, stdout: false }), null, path);
    assert.equal(userOnly(path, new Set(["--mcp", "--interactive"]), tty), null, path);
  }
  // logout --mcp is not person-only.
  assert.equal(userOnly("auth logout", new Set(["--mcp"])), null);
  assert.equal(userOnly("logout", new Set(["--mcp"])), null);
});

test("auth login --mcp is refused before HEY runs; logout --mcp is forwarded", async () => {
  const fake = await makeFakeHey({ stdout: '{"ok":true,"data":{"authenticated":false}}' });
  const login = await runAxi(["auth", "login", "--mcp"], { fake });
  assert.equal(login.code, 2, login.stdout);
  assert.match(login.stdout, /error: needs the user/);
  assert.match(login.stdout, /hey-axi auth login --interactive/);

  const alias = await runAxi(["login", "--mcp"], { fake });
  assert.equal(alias.code, 2, alias.stdout);
  assert.match(alias.stdout, /error: needs the user/);

  const logout = await runAxi(["auth", "logout", "--mcp"], { fake });
  assert.equal(logout.code, 0, logout.stdout);
  const top = await runAxi(["logout", "--mcp"], { fake });
  assert.equal(top.code, 0, top.stdout);
  assert.deepEqual(await fake.calls(), ["auth logout --mcp --json", "logout --mcp --json"]);
  await fake.cleanup();
});

test("auth login --help and logout --help show --mcp; reply --help shows --from", async () => {
  const login = await runAxi(["auth", "login", "--help"]);
  assert.equal(login.code, 0, login.stdout);
  assert.match(login.stdout, /--mcp  Sign in hey mcp with its own credential \(read, write and send\) \(default false\)/);

  const logout = await runAxi(["auth", "logout", "--help"]);
  assert.equal(logout.code, 0, logout.stdout);
  assert.match(logout.stdout, /--mcp  Sign hey mcp out: revoke its sign-in and remove its credential \(default false\)/);
  assert.match(logout.stdout, /hey-axi auth logout --mcp/);

  const reply = await runAxi(["reply", "--help"]);
  assert.equal(reply.code, 0, reply.stdout);
  assert.match(reply.stdout, /--from <string>\s+Configured sender email or ID within the thread's account \(see hey account senders\) \(default: none\)/);
  assert.match(reply.stdout, /hey-axi reply 12345 --from billing@example\.org -m "The revised invoice is ready for review\."/);
  assert.match(reply.stdout, /Works with --draft and --dry-run/);
});

test("reply --from is forwarded in order and still stages a draft without --allow-send", async () => {
  const fake = await makeFakeHey({ stdout: '{"ok":true,"data":{"id":2201},"summary":"Draft saved"}' });
  const result = await runAxi(["reply", "12345", "--from", "billing@example.org", "-m", "The revised invoice is ready."], { fake });
  assert.equal(result.code, 0, result.stdout);
  assert.match(result.stdout, /sent: false/);
  assert.match(result.stdout, /saved_as: draft/);
  assert.deepEqual(await fake.calls(), ["reply 12345 --from billing@example.org -m The revised invoice is ready. --draft --json"]);
  await fake.cleanup();
});

test("reply --from with --allow-send and --dry-run is forwarded without staging a draft", async () => {
  const fake = await makeFakeHey({ stdout: '{"ok":true,"data":{"from":"billing@example.org"},"summary":"Dry run"}' });
  const dry = await runAxi(["reply", "12345", "--from", "billing@example.org", "--dry-run"], { fake });
  assert.equal(dry.code, 0, dry.stdout);
  const sent = await runAxi(["reply", "12345", "--from", "42", "-m", "Thanks", "--allow-send"], { fake });
  assert.equal(sent.code, 0, sent.stdout);
  assert.deepEqual(await fake.calls(), [
    "reply 12345 --from billing@example.org --dry-run --json",
    "reply 12345 --from 42 -m Thanks --json",
  ]);
  await fake.cleanup();
});
