// The no-args home view (AXI principles 7, 8 and 10): who this is, the directory scope,
// live mail for that scope with its count, what the last session in this directory did,
// then the next commands. It is also what the session hook prints. It never fails hard:
// a missing or signed-out HEY is reported as `status` with the fix (exit 0), so a
// session hook still gives the agent something useful.

import { DESCRIPTION, SETUP_HELP, homeHelp } from "./guide.js";
import { carrySelectors, countLine, listSize, shapeData, findList } from "./shape.js";
import { heyFailure } from "./errors.js";
import { heyToAxi } from "./text.js";
import { ScopeError, findScope, scopeQuery } from "./scope.js";
import { lastSession } from "./activity.js";
import { collapse } from "./home-path.js";

export { collapse };

export async function homeView(runHey, { execPath = process.argv[1], cwd = process.cwd() } = {}) {
  const out = { bin: collapse(execPath), description: DESCRIPTION };
  let scope = null;
  try {
    scope = findScope(cwd);
  } catch (error) {
    if (!(error instanceof ScopeError)) throw error;
    out.status = error.message;
    out.help = ["Fix or delete that file, then run `hey-axi` again", "Run `hey-axi setup scope --help` for the format"];
    return out;
  }
  const query = scopeQuery(scope);
  out.scope = query.label;
  const previous = lastSession(scope?.dir || cwd);
  if (previous) out.last_session = previous.line;

  const result = await runHey(query.argv, ["--json"]);
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
    out.help = out.help.map((line) => carrySelectors(line, query.carry || []));
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
  const body = envelope && typeof envelope === "object" && "data" in envelope ? envelope.data : envelope;
  const found = findList(body);
  const size = listSize(envelope, found ? found.list.length : 0, found?.container);
  // search has no --limit: keep the first `limit` rows here.
  if (found && found.list.length > query.limit) {
    // More rows than shown, but no total unless HEY gave one.
    size.more = true;
  }
  const { data, truncated } = shapeData(body, { path: query.path });
  let threads = Array.isArray(data) ? data : data?.[found?.key];
  if (threads && threads.length > query.limit) threads = threads.slice(0, query.limit);
  size.shown = threads?.length ?? 0;
  const where = query.label.split(" (")[0];
  if (!threads?.length && (size.more || size.total > 0)) {
    // An empty page while HEY reports more: say exactly that, not "nothing".
    out.count = countLine(size);
    out.mail = `0 threads on this page; HEY reports ${size.total > 0 ? `${size.total} in total` : "more"}`;
  } else if (!threads?.length && size.complete) {
    // "Nothing" only when HEY says nothing is left (a total of 0, has_more: false, no next page).
    out.count = countLine(size);
    out.mail = `0 threads: nothing in ${where}`;
  } else if (!threads?.length) {
    // An empty first page with no paging signal either way: report the page, claim no more.
    out.count = countLine(size);
    out.mail = `0 threads on this page of ${where}; HEY reported no total and no further pages`;
  } else {
    out.count = countLine(size);
    out.threads = threads;
  }
  const unsure = !threads?.length && !size.more && !(size.total > 0) && !size.complete;
  out.help = homeHelp({ base: query.base, carry: query.carry, more: size.more, total: size.total, truncated, drafts: previous?.drafts > 0, search: query.path === "search", unsure });
  return out;
}
