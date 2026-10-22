// What HEY added or changed between v1.8.0 (732568e) and v1.10.0 (2f061c6): `contact photo
// set`/`remove` (#566), and HEY's 422 refusal reasons (hey-sdk 0.33, #592). Fake HEY only.
import test from "node:test";
import assert from "node:assert/strict";
import { makeFakeHey, runAxi } from "./helpers.js";
import { loadBundledManifest, resolveCommand, coverageLabel } from "../src/router.js";
import { runMode, checkPolicy, sendCommands, destructiveCommands, noopFor } from "../src/policy.js";
import { translateFailure } from "../src/errors.js";

const manifest = loadBundledManifest();

// HEY's writeMutationLine envelopes (internal/cmd/contact_photo.go).
const SET_OK = JSON.stringify({ ok: true, data: { id: 12345, name: "Jane Doe", avatar_url: "https://hey.com/avatars/12345.jpg" }, summary: "Contact photo saved", breadcrumbs: [{ action: "remove", command: "hey contact photo remove 12345", description: "Remove the photo" }] });
const REMOVE_OK = JSON.stringify({ ok: true, data: { id: 12345 }, summary: "Contact photo removed", breadcrumbs: [{ action: "set", command: "hey contact photo set 12345 <file>", description: "Upload a photo" }] });

test("the manifest pins HEY v1.10.0 and has contact photo, photo set and photo remove", () => {
  assert.equal(manifest.hey_version, "1.10.0");
  assert.equal(coverageLabel(manifest), "v1.10.0");
  const set = resolveCommand(manifest.commands, ["contact", "photo", "set"]);
  assert.equal(set.path, "contact photo set");
  assert.deepEqual(set.node.synopsis, ["hey contact photo set <contact-id> <file> [flags]"]);
  const remove = resolveCommand(manifest.commands, ["contact", "photo", "remove"]);
  assert.deepEqual(remove.node.synopsis, ["hey contact photo remove <contact-id> [flags]"]);
  const group = manifest.commands.find((node) => node.name === "contact").subcommands.find((node) => node.name === "photo");
  assert.match(group.notes, /PNG or JPEG/);
});

test("contact photo set/remove are ordinary writes: not a send, a secret, destructive or a no-op candidate", () => {
  for (const path of ["contact photo set", "contact photo remove", "contact note set", "contact update"]) {
    assert.equal(runMode(path, new Set()), "json", path);
    assert.equal(checkPolicy(path, new Set(), {}, { stdin: true, stdout: true }), null, path);
    assert.ok(!sendCommands().includes(path), path);
    assert.ok(!destructiveCommands().includes(path), path);
  }
  // HEY answers not_found for a contact you can't edit too, so not_found isn't "already gone".
  assert.equal(noopFor("contact photo remove", { ok: false, error: 'contact "12345" not found', kind: "not_found" }, ["12345"], {}), null);
});

test("contact photo set/remove forward argv intact and keep HEY's summary and next-command hint", async () => {
  const set = await makeFakeHey({ stdout: SET_OK });
  const ok = await runAxi(["contact", "photo", "set", "12345", "headshot.png"], { fake: set });
  assert.equal(ok.code, 0, ok.stdout);
  assert.match(ok.stdout, /summary: Contact photo saved/);
  assert.match(ok.stdout, /hey-axi contact photo remove 12345/);
  assert.doesNotMatch(ok.stdout, /sent:/);
  const noFile = await runAxi(["contact", "photo", "set", "12345"], { fake: set });
  assert.equal(noFile.code, 2, noFile.stdout);
  assert.match(noFile.stdout, /missing argument <file>/);
  assert.deepEqual(await set.calls(), ["contact photo set 12345 headshot.png --json"]);
  await set.cleanup();

  const remove = await makeFakeHey({ stdout: REMOVE_OK });
  const gone = await runAxi(["contact", "photo", "remove", "12345"], { fake: remove });
  assert.equal(gone.code, 0, gone.stdout);
  assert.match(gone.stdout, /summary: Contact photo removed/);
  assert.match(gone.stdout, /hey-axi contact photo set 12345 <file>/);
  const noId = await runAxi(["contact", "photo", "remove"], { fake: remove });
  assert.equal(noId.code, 2);
  assert.match(noId.stdout, /missing argument <contact-id>/);
  assert.deepEqual(await remove.calls(), ["contact photo remove 12345 --json"]);
  await remove.cleanup();
});

test("contact photo --help is offline and carries HEY's notes and examples", async () => {
  const set = await runAxi(["contact", "photo", "set", "--help"]);
  assert.equal(set.code, 0);
  assert.match(set.stdout, /usage: hey-axi contact photo set <contact-id> <file> \[flags\]/);
  assert.match(set.stdout, /hey-axi contact photo set 12345 ~\/Pictures\/jane-doe\.jpg/);
  const group = await runAxi(["contact", "photo", "--help"]);
  assert.equal(group.code, 0);
  assert.match(group.stdout, /contact photo set — Upload a photo for a contact/);
  assert.match(group.stdout, /contact photo remove — Remove a contact's photo/);
  assert.match(group.stdout, /notes: Set takes a contact ID and a local PNG or JPEG file/);
  // Any group without a form of its own answers --help the same way.
  const note = await runAxi(["contact", "note", "--help"]);
  assert.equal(note.code, 0, note.stdout);
  assert.match(note.stdout, /contact note set/);
});

test("HEY's `avatar` alias is handled like HEY's other subcommand aliases: refused before HEY runs, naming `photo`", async () => {
  const fake = await makeFakeHey({ stdout: REMOVE_OK });
  for (const line of [["contact", "avatar", "remove", "12345"], ["clip", "rm", "5"]]) {
    const result = await runAxi(line, { fake });
    assert.equal(result.code, 2, line.join(" "));
    assert.match(result.stdout, /unknown subcommand/);
  }
  const avatar = await runAxi(["contact", "avatar", "set", "1", "a.png"], { fake });
  assert.match(avatar.stdout, /Did you mean `hey-axi contact photo`\?/);
  assert.match((await runAxi(["clip", "rm", "5"], { fake })).stdout, /Did you mean `hey-axi clip delete`\?/);
  assert.deepEqual(await fake.calls(), []);
  await fake.cleanup();
});

test("a contact photo not_found keeps HEY's hint about which contacts can be edited", async () => {
  const fake = await makeFakeHey({ exitCode: 2, stdout: "", stderr: JSON.stringify({ ok: false, error: 'contact "12345" not found', code: "not_found", hint: "HEY changes the photo of a contact you can edit, or your own: not a hidden contact, an alias, or another HEY user." }) });
  const result = await runAxi(["contact", "photo", "remove", "12345"], { fake });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /kind: not_found/);
  assert.match(result.stdout, /not a hidden contact, an alias, or another HEY user/);
  await fake.cleanup();
});

test("HEY's 422 refusal reasons reach the agent whole, listed, with a next step", async () => {
  // hey-sdk 0.33 joins HEY's reasons with "; " (field-named ones as "field: message").
  const long = `Name can't be blank; email_address: has already been taken by another contact on this account; ${"alias_email_addresses: is invalid ".repeat(5).trim()}; base: The contact can't be both an alias and a contact`;
  const fake = await makeFakeHey({ exitCode: 1, stdout: "", stderr: JSON.stringify({ ok: false, error: long, code: "validation" }) });
  const result = await runAxi(["contact", "update", "12345", "--name", ""], { fake });
  assert.equal(result.code, 2, result.stdout);
  assert.match(result.stdout, /code: validation/);
  // Every reason survives, including the last one past 200 characters.
  assert.ok(long.length > 200);
  assert.match(result.stdout, /Name can't be blank/);
  assert.match(result.stdout, /has already been taken by another contact/);
  assert.match(result.stdout, /The contact can't be both an alias and a contact/);
  assert.doesNotMatch(result.stdout, /…/);
  assert.match(result.stdout, /reasons\[4\]:/);
  assert.match(result.stdout, /HEY refused the request for the reason\(s\) above: fix what they name/);
  await fake.cleanup();

  const one = translateFailure({ status: 1, stderr: JSON.stringify({ ok: false, error: "Subject is too long (maximum is 255 characters)", code: "validation" }) }).failure;
  assert.equal(one.error, "Subject is too long (maximum is 255 characters)");
  assert.equal(one.reasons, undefined);
  // A bare 422 (no reasons) still reads as HEY's message.
  assert.equal(translateFailure({ status: 1, stderr: '{"ok":false,"error":"validation error","code":"validation"}' }).failure.error, "validation error");
  // Other errors are still cut at 200 characters.
  assert.match(translateFailure({ status: 7, stderr: JSON.stringify({ ok: false, error: "x".repeat(300), code: "api" }) }).failure.error, /…$/);
});

test("contact photo on a HEY older than v1.9.0 is named as outdated", async () => {
  const fake = await makeFakeHey({ exitCode: 1, stdout: "", stderr: '{"ok":false,"error":"unknown command \\"photo\\" for \\"hey contact\\"","code":"usage"}\n' });
  const result = await runAxi(["contact", "photo", "remove", "12345"], { fake });
  assert.equal(result.code, 1, result.stdout);
  assert.match(result.stdout, /kind: hey_outdated/);
  assert.match(result.stdout, /hey-axi's catalog is HEY CLI v1\.10\.0/);
  await fake.cleanup();
});
