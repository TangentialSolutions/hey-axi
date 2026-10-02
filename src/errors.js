// Turn a failed HEY run into hey-axi's error shape, keeping HEY's own error envelope
// ({ok:false,error,code,hint,meta}, written to stderr in --json mode) when there is one.
// HEY may print plain warning lines (e.g. about the keyring) before the envelope; those
// are kept as `warning`.

function findEnvelope(text) {
  if (!text) return null;
  const starts = [];
  if (text.trimStart().startsWith("{")) starts.push(text.indexOf("{"));
  for (let i = text.indexOf("\n{"); i !== -1; i = text.indexOf("\n{", i + 1)) starts.push(i + 1);
  for (const start of starts) {
    try {
      const parsed = JSON.parse(text.slice(start));
      if (parsed && typeof parsed === "object" && parsed.ok === false && parsed.error) {
        return { envelope: parsed, prefix: text.slice(0, start).trim() };
      }
    } catch {
      // not an envelope from here; try the next candidate
    }
  }
  return null;
}

export function heyFailure(result) {
  if (result.error) return { ok: false, error: result.error, exit_code: result.status };
  for (const text of [result.stderr, result.stdout]) {
    const found = findEnvelope(text);
    if (!found) continue;
    const failure = { ok: false, error: found.envelope.error };
    for (const key of ["code", "hint", "meta"]) {
      if (found.envelope[key] !== undefined && found.envelope[key] !== "") failure[key] = found.envelope[key];
    }
    if (found.prefix) failure.warning = found.prefix;
    failure.exit_code = result.status;
    return failure;
  }
  const message = (result.stderr || "").trim() || (result.stdout || "").trim() || "hey command failed";
  return { ok: false, error: message, exit_code: result.status };
}
