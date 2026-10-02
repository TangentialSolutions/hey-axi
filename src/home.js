// The no-args home view (AXI principles 8 and 10): who this is, then live Imbox state,
// then the next commands. Also what the session hook prints. It never fails hard:
// a missing or signed-out HEY is reported as `status` with the fix (exit 0), so a
// session hook still gives the agent something useful.

import { homedir } from "node:os";
import { DESCRIPTION, HOME_HELP, HOME_LIMIT, SETUP_HELP } from "./guide.js";
import { shapeData } from "./shape.js";
import { heyFailure } from "./errors.js";
import { heyToAxi } from "./text.js";

export function collapse(path, home = homedir()) {
  return path && home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

export async function homeView(runHey, { execPath = process.argv[1] } = {}) {
  const out = { bin: collapse(execPath), description: DESCRIPTION };
  const result = await runHey(["box", "view", "imbox", "--limit", String(HOME_LIMIT)], ["--json"]);
  if (result.status === 127) {
    out.status = result.error || "HEY CLI not found";
    out.help = SETUP_HELP.missing;
    return out;
  }
  if (result.status !== 0) {
    const failure = heyFailure(result);
    if (result.status === 3 || failure.code === "auth") {
      out.status = "not signed in to HEY";
      out.help = SETUP_HELP.auth;
    } else {
      out.status = `HEY error: ${heyToAxi(failure.error)}`;
      out.help = [...(failure.hint ? [heyToAxi(failure.hint)] : []), ...SETUP_HELP.other];
    }
    return out;
  }
  let envelope;
  try {
    envelope = JSON.parse(result.stdout);
  } catch {
    out.status = "HEY returned invalid JSON";
    out.help = SETUP_HELP.other;
    return out;
  }
  const { data, empty } = shapeData(envelope.data, { path: "box view" });
  const threads = Array.isArray(data) ? data : data?.postings;
  out.imbox = envelope.summary || `${threads?.length ?? 0} threads`;
  if (empty || !threads?.length) out.imbox = "0 threads: the Imbox is empty";
  else out.threads = threads;
  out.help = HOME_HELP;
  return out;
}
