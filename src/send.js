// Reading what HEY says about outgoing mail.
//
// HEY CLI v1.7.0 answers a send with a summary only. HEY's main branch (unreleased as of
// 2026-10-06, commit 9dfe00f) also:
//   - names what went out: data.id (the message), data.topic_id (its thread), subject,
//     and delayed (true while Undo Send holds it back; the thread doesn't show it yet)
//   - fails a send HEY refused (usually the sending limit) with code not_delivered (exit 7),
//     naming the draft HEY kept in meta.draft_id; sending again only makes another draft
//   - refuses a --to/--cc/--bcc address it would otherwise drop (code usage,
//     "not a valid email address: X") before anything is sent
// hey-axi reads both shapes. It also refuses clearly broken addresses itself, before HEY
// runs, so a v1.7.0 HEY can't silently drop a recipient either.

// Commands whose recipient flags HEY checks (compose, reply, forward, draft edit).
export const RECIPIENT_COMMANDS = new Set(["compose", "reply", "forward", "draft edit"]);
const RECIPIENT_FLAGS = new Set(["--to", "--cc", "--bcc"]);

// Split a recipient list on commas outside quotes, comments and angle brackets
// ("Bryan, Annie" <annie@example.com> is one recipient).
export function splitAddresses(text) {
  const out = [];
  let current = "";
  let quoted = false;
  let depth = 0;
  let angled = false;
  for (const char of String(text)) {
    if (char === "\"" && depth === 0) quoted = !quoted;
    else if (!quoted && char === "(") depth += 1;
    else if (!quoted && char === ")" && depth > 0) depth -= 1;
    else if (!quoted && depth === 0 && char === "<") angled = true;
    else if (!quoted && depth === 0 && char === ">") angled = false;
    if (char === "," && !quoted && depth === 0 && !angled) {
      if (current.trim()) out.push(current.trim());
      current = "";
    } else current += char;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

// A deliberately loose check: a local part, an @, and a domain with a dot and a top-level
// part of two or more characters. Anything it refuses, HEY refuses too (or, before its
// main branch, silently drops); HEY's own, stricter check still runs after it.
const ADDRESS = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;.]{2,}$/u;

export function invalidAddress(entry) {
  const angle = entry.match(/<([^<>]*)>\s*$/);
  const address = (angle ? angle[1] : entry).trim();
  return ADDRESS.test(address) ? null : address || entry;
}

// Returns null, or a refusal (exit 2) naming the first address HEY would drop.
export function recipientProblem(path, values = []) {
  if (!RECIPIENT_COMMANDS.has(path)) return null;
  for (const [name, value] of values) {
    if (!RECIPIENT_FLAGS.has(name)) continue;
    for (const entry of splitAddresses(value)) {
      const bad = invalidAddress(entry);
      if (bad) return recipientRefusal(path, bad);
    }
  }
  return null;
}

export function recipientRefusal(path, address) {
  return {
    error: `not a valid email address: ${address}`,
    command: path,
    sent: false,
    reason: "HEY would drop this recipient without saying so (no domain, or no top-level domain); nothing was sent",
    hint: `fix or remove "${address}": every recipient needs a full address such as name@example.com`,
  };
}

// HEY's own refusal of a recipient, as its error line words it.
export const HEY_BAD_ADDRESS = /^not a valid email address: (.+)$/i;

// The draft HEY kept when it refused a send: meta.draft_id, else the id in its hint or message.
export function keptDraftId(envelope) {
  const fromMeta = envelope?.meta?.draft_id;
  if (fromMeta !== undefined && fromMeta !== null && /^\d+$/.test(String(fromMeta))) return String(fromMeta);
  const text = `${envelope?.hint || ""} ${envelope?.error || ""}`;
  const match = text.match(/\bdraft(?: send)? (\d+)\b/i);
  return match ? match[1] : null;
}

// The failure for a send HEY refused and kept as a draft: never retry the send.
export function notDelivered(envelope) {
  const draft = keptDraftId(envelope);
  const failure = {
    ok: false,
    kind: "not_delivered",
    sent: false,
    error: draft
      ? `not sent: HEY kept the message as draft ${draft} instead of sending it (usually the account's sending limit)`
      : "not sent: HEY kept the message as a draft instead of sending it (usually the account's sending limit)",
  };
  if (draft) failure.draft_id = draft;
  failure.help = draft
    ? [
      `Run \`hey-axi draft show ${draft}\` to review it`,
      `Run \`hey-axi draft send ${draft} --allow-send\` later, once the account can send again; don't repeat the send, which only makes another draft`,
    ]
    : ["Run `hey-axi draft list` to find the draft HEY kept; don't repeat the send, which only makes another draft"];
  return failure;
}

// Mark a delivered message's result. `data` is HEY's answer: v1.7.0 names nothing; main
// names id, topic_id, subject and delayed. Nothing is guessed when HEY leaves it out.
export function markSent(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const data = result.data && typeof result.data === "object" && !Array.isArray(result.data) ? result.data : {};
  const marker = { sent: true };
  if (data.delayed === true) {
    // topic_id is the thread it is on (forward's thread_id names the thread forwarded).
    const thread = data.topic_id;
    marker.held = `Undo Send is holding it back: it goes out when HEY releases it, and until then ${thread !== undefined ? `\`hey-axi thread read ${thread}\`` : "the thread"} won't show it (a thread it starts reads as not found)`;
  }
  const { ok, ...rest } = result;
  return ok === undefined ? { ...marker, ...rest } : { ok, ...marker, ...rest };
}
