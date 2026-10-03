// Shape HEY's JSON for agents (AXI principles 2-5 and 9):
//   - at most four default fields per list command, `--fields a,b,c` to choose, `--fields all`
//   - long text truncated with its total size, `--full` to get HEY's output untouched
//   - every list gets a `count` (`N of T total`, `N total`, or `N shown; more available`)
//     and a definitive `empty` line when it has no rows, enveloped or not
//   - HEY's breadcrumbs as `help` lines that name hey-axi commands and carry the
//     invocation's selectors (--account, --base-url)
import { heyToAxi } from "./text.js";

// A field is "key" or "key=path", where path is dotted (`creator.name`), may index an
// array (`messages.0.creator.name`), may map over one (`recipients.to[].email_address`,
// joined with ", "), and may list fallbacks (`name|subject`).
// Box rows keep both ids: `id` (the box item) feeds seen/unseen/move/label, `topic_id`
// (the thread) feeds thread read/reply/forward. `seen` and `at` are one --fields away.
const POSTINGS = ["id", "topic_id", "from=creator.name|sender.name|alternative_sender_name", "subject=name|subject"];
const EVENTS = ["id", "title", "starts_at", "ends_at"];
const NAMED = ["id", "name"];

export const LIST_FIELDS = {
  box: POSTINGS,
  "box view": POSTINGS,
  label: POSTINGS,
  "label view": POSTINGS,
  collection: POSTINGS,
  "collection view": POSTINGS,
  bundle: POSTINGS,
  "bundle view": POSTINGS,
  "set-aside view": POSTINGS,
  "set-aside group view": POSTINGS,
  "contact threads": POSTINGS,
  "bubble list": ["id", "topic_id", "subject=name|subject", "bubbles_up=bubble_up_schedule.bubble_up_at"],
  "box list": ["id", "kind", "name"],
  search: ["topic_id", "subject", "from=messages.0.creator.name|creator.name", "at=updated_at|created_at"],
  "screener list": ["id", "email_address", "subject", "topic_id"],
  "screener history": ["id", "status", "email_address=email_address|petitioner.email_address", "decided=decided|updated_at"],
  "event list": EVENTS,
  "event day": EVENTS,
  "event week": EVENTS,
  "todo list": ["id", "title", "starts_at", "completed_at"],
  "habit list": ["id", "title=title|name", "days"],
  "journal list": ["id", "date=date|starts_at"],
  "draft list": ["id", "subject", "summary", "at=updated_at|created_at"],
  "contact list": ["id", "name", "email_address"],
  "label list": NAMED,
  "collection list": NAMED,
  "workflow list": NAMED,
  "calendar list": ["id", "name", "kind", "owned"],
  "attachment list": ["id", "filename", "content_type", "byte_size"],
  "clip list": ["id", "topic_id=topic_id|topic.id", "at=created_at"],
  "snippet list": ["id", "name"],
  "timetrack list": ["id", "starts_at", "ends_at", "category"],
  "timetrack categories": ["id", "title"],
  "account list": ["id", "email=email|email_address", "name", "active"],
  "set-aside group list": ["id", "thread_count"],
};

// Detail views keep their long text (truncated), but drop URLs and duplicated fields.
// Lists whose entries are long-form content: the list shows ids and dates only, and a help
// line says how to get the content (AXI principle 2: long text belongs in detail views).
export const CONTENT_LISTS = {
  "journal list": (line, carry) => `Run \`${withSelectors("hey-axi journal read <date>", carry)}\` to read one entry, or \`${line} --fields id,starts_at,content\` to include previews`,
  "clip list": (line) => `Run \`${line} --fields id,content\` to include each clip's content`,
  "snippet list": (line) => `Run \`${line} --fields id,name,content\` to include each snippet's content`,
};

export const DETAIL_FIELDS = {
  "thread read": ["id", "at=created_at", "from=creator.name|sender.name", "email=creator.email_address|sender.email_address", "to=recipients.to[].email_address", "cc=recipients.cc[].email_address", "body=body|summary"],
};

export const LIST_TEXT_LIMIT = 120;
export const DETAIL_TEXT_LIMIT = 1000;

const HEURISTIC_KEYS = ["id", "topic_id", "name", "title", "subject", "email_address", "status", "kind", "type", "starts_at", "created_at"];

const present = (value) => value !== undefined && value !== null && value !== "";

function getPath(value, parts) {
  if (parts.length === 0) return value;
  if (value === null || typeof value !== "object") return undefined;
  const [part, ...rest] = parts;
  if (part.endsWith("[]")) {
    const list = value[part.slice(0, -2)];
    if (!Array.isArray(list)) return undefined;
    const values = list.map((item) => getPath(item, rest)).filter(present);
    return values.length ? values.join(", ") : undefined;
  }
  return getPath(value[part], rest);
}

function resolve(item, path) {
  for (const alternative of path.split("|")) {
    const value = getPath(item, alternative.split("."));
    if (present(value)) return value;
  }
  return undefined;
}

export function parseField(spec) {
  const index = spec.indexOf("=");
  return index === -1 ? { key: spec, path: spec } : { key: spec.slice(0, index), path: spec.slice(index + 1) };
}

export const MAX_LIST_FIELDS = 4;

// Fields for a list without a declared schema: up to four familiar keys, or the first
// four keys when none of the familiar ones are there.
function heuristicFields(items) {
  const keys = [...new Set(items.flatMap((item) => (item && typeof item === "object" ? Object.keys(item) : [])))];
  if (keys.length <= MAX_LIST_FIELDS) return null;
  const picked = HEURISTIC_KEYS.filter((key) => keys.includes(key)).slice(0, MAX_LIST_FIELDS);
  return picked.length >= 2 ? picked : keys.slice(0, MAX_LIST_FIELDS);
}

// Project items onto fields. Returns { rows, unknown } where unknown lists requested
// fields that matched nothing in any item.
export function project(items, specs, { strict = false } = {}) {
  const fields = specs.map(parseField);
  const rows = items.map((item) => Object.fromEntries(fields.map(({ key, path }) => [key, resolve(item, path)])));
  const used = fields.filter(({ key }) => rows.some((row) => row[key] !== undefined));
  const unknown = strict && items.length ? fields.filter((field) => !used.includes(field)).map(({ key }) => key) : [];
  const keep = strict ? fields : used;
  return {
    rows: rows.map((row) => Object.fromEntries(keep.map(({ key }) => [key, row[key] === undefined ? null : row[key]]))),
    unknown,
  };
}

// Truncate long strings anywhere in a value. Calls onTruncate for each cut.
export function truncateDeep(value, limit, onTruncate, list = false) {
  if (typeof value === "string") {
    if (value.length <= limit) return value;
    onTruncate();
    return list
      ? `${value.slice(0, limit)}… (${value.length} chars)`
      : `${value.slice(0, limit)}… (truncated, ${value.length} chars total)`;
  }
  if (Array.isArray(value)) return value.map((item) => truncateDeep(item, limit, onTruncate, list));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, truncateDeep(item, limit, onTruncate, list)]));
  }
  return value;
}

const isObjectList = (value) => Array.isArray(value) && value.every((item) => item && typeof item === "object" && !Array.isArray(item));
// URLs and paging fields (summarized by `count` and the "see the rest" help) are left out.
const DROP_CONTAINER_KEY = (key) => /(^|_)url$|^signed_stream_name$|^(total_count|next_page|next_cursor|has_more)$/.test(key);

// Find the collection in HEY's `data`: the array itself (of objects or of plain
// values), the one array of objects inside a container object (e.g. a box with its
// postings), or, when a container holds several, all of them (`lists`).
export function findList(data) {
  if (isObjectList(data)) return { list: data };
  if (Array.isArray(data)) return { list: data, primitive: true };
  if (data && typeof data === "object") {
    const keys = Object.keys(data).filter((key) => isObjectList(data[key]));
    if (keys.length === 1) return { list: data[keys[0]], key: keys[0], container: data };
    if (keys.length > 1) return { lists: keys.map((key) => ({ key, list: data[key] })), container: data, list: keys.flatMap((key) => data[key]) };
    // One list of plain values next to other fields ({items: ["a","b"], total_count: 40}).
    const plain = Object.keys(data).filter((key) => Array.isArray(data[key]));
    if (keys.length === 0 && plain.length === 1) return { list: data[plain[0]], key: plain[0], container: data, primitive: true };
  }
  return null;
}

export function fieldsFor(path, items) {
  return LIST_FIELDS[path] || DETAIL_FIELDS[path] || heuristicFields(items);
}

// Every key an agent could pass to --fields for this result.
export function availableFields(path, items) {
  const names = new Set((fieldsFor(path, items) || []).map((spec) => parseField(spec).key));
  for (const item of items.slice(0, 5)) for (const key of Object.keys(item || {})) names.add(key);
  return [...names];
}

export class FieldError extends Error {
  constructor(unknown, available) {
    super("unknown field");
    this.unknown = unknown;
    this.available = available;
  }
}

// Shape `data` for one command. options: { path, fields: string[]|"all"|null }.
// Returns { data, truncated, empty }.
export function shapeData(data, { path, fields = null }) {
  let truncated = false;
  const mark = () => { truncated = true; };
  const found = findList(data);
  const detail = Boolean(DETAIL_FIELDS[path]) || !found;

  if (!found) {
    return { data: truncateDeep(data, DETAIL_TEXT_LIMIT, mark), truncated, empty: false };
  }
  if (found.primitive && !found.container) {
    return { data: truncateDeep(found.list, LIST_TEXT_LIMIT, mark, true), truncated, empty: found.list.length === 0 };
  }
  if (found.primitive) {
    const shaped = {};
    for (const [name, value] of Object.entries(found.container)) {
      if (name === found.key) shaped[name] = truncateDeep(value, LIST_TEXT_LIMIT, mark, true);
      else if (fields === "all" || !DROP_CONTAINER_KEY(name)) shaped[name] = truncateDeep(value, DETAIL_TEXT_LIMIT, mark);
    }
    return { data: shaped, truncated, empty: found.list.length === 0 };
  }
  if (found.lists) {
    // Several collections side by side: each gets the minimal schema of its own items.
    const shaped = {};
    for (const [name, value] of Object.entries(found.container)) {
      const entry = found.lists.find((item) => item.key === name);
      if (entry && Array.isArray(fields) && fields.length) {
        // Explicit fields must exist in at least one of the lists.
        const unknown = fields.filter((field) => !found.lists.some(({ list }) => project(list, [field], { strict: false }).rows.some((row) => Object.keys(row).length)));
        if (unknown.length) throw new FieldError(unknown, [...new Set(found.lists.flatMap(({ list }) => list.slice(0, 5).flatMap((item) => Object.keys(item || {}))))]);
      }
      if (entry) {
        const specs = fields === "all" ? null : Array.isArray(fields) && fields.length ? fields : heuristicFields(entry.list);
        const rows = specs ? project(entry.list, specs).rows : entry.list;
        shaped[name] = truncateDeep(rows, specs ? LIST_TEXT_LIMIT : DETAIL_TEXT_LIMIT, mark, Boolean(specs));
      } else if (fields === "all" || !DROP_CONTAINER_KEY(name)) {
        // Content next to the lists is kept (long text cut with its size), never dropped.
        shaped[name] = truncateDeep(value, DETAIL_TEXT_LIMIT, mark);
      }
    }
    return { data: shaped, truncated, empty: found.list.length === 0 };
  }

  const { list, key, container } = found;
  let rows = list;
  let projected = false;
  if (fields !== "all") {
    const explicit = Array.isArray(fields) && fields.length > 0;
    const defaults = fieldsFor(path, list);
    let specs = defaults;
    if (explicit) {
      const known = new Map((defaults || []).map((spec) => [parseField(spec).key, spec]));
      specs = fields.map((name) => known.get(name) || name);
    }
    if (specs) {
      const result = project(list, specs, { strict: explicit });
      if (result.unknown.length) throw new FieldError(result.unknown, availableFields(path, list));
      rows = result.rows;
      projected = true;
    }
  }
  const listLimit = detail || !projected ? DETAIL_TEXT_LIMIT : LIST_TEXT_LIMIT;
  rows = truncateDeep(rows, listLimit, mark, !detail && projected);

  let shaped = rows;
  if (container) {
    shaped = {};
    for (const [name, value] of Object.entries(container)) {
      if (name === key) shaped[name] = rows;
      else if (fields === "all" || !DROP_CONTAINER_KEY(name)) {
        // Content next to the list is kept (long text cut with its size), never dropped.
        shaped[name] = truncateDeep(value, DETAIL_TEXT_LIMIT, mark);
      }
    }
  }
  return { data: shaped, truncated, empty: list.length === 0 };
}

const MORE_NOTICE = /more (are )?available|more results|use --all|--page/i;
const TOTAL_NOTICE = /\b\d[\d,]* of (\d[\d,]*)\b/;

// What HEY told us about the size of a list: { shown, total?, more, next? }. Sources, in
// order: meta.total_count, a "Showing N of T" notice, and HEY's paging signals
// (next_page, has_more, a "more available" notice). With none of them the list is complete.
export function listSize(envelope, shown, container = null) {
  // HEY puts paging in meta, or (box and other postings listings) next to the list in data.
  const ownMeta = envelope && typeof envelope.meta === "object" && envelope.meta ? envelope.meta : {};
  const side = container && typeof container === "object" ? Object.fromEntries(["total_count", "next_page", "next_cursor", "has_more"].filter((key) => key in container).map((key) => [key, container[key]])) : {};
  const meta = { ...side, ...ownMeta };
  if (typeof meta.total_count === "number" && meta.total_count < shown) delete meta.total_count;
  const next = meta.next_page ?? meta.next_cursor ?? null;
  const noticed = String(envelope?.notice || "").match(TOTAL_NOTICE);
  const total = typeof meta.total_count === "number" ? meta.total_count : noticed ? Number(noticed[1].replace(/,/g, "")) : undefined;
  const more = total !== undefined ? total > shown : Boolean(next || meta.has_more || MORE_NOTICE.test(envelope?.notice || ""));
  // Complete only when HEY says so: a total, has_more: false, or a null next_page.
  const complete = total !== undefined ? !more : !more && (meta.has_more === false || ("next_page" in meta && meta.next_page === null) || ("next_cursor" in meta && meta.next_cursor === null));
  return { shown, total, more, next, complete };
}

// `count: 25 of 847 total` / `count: 8 total` / `count: 25 shown; more available` /
// `count: 25 shown; no more pages reported` (no total and no explicit end signal:
// hey-axi does not claim the list is complete).
export function countLine({ shown, total, more, complete, all = false }) {
  if (total !== undefined) return `${shown} of ${total} total`;
  if (more) return `${shown} shown; more available`;
  // An empty page is only "0 total" when HEY says nothing is left (or --all fetched everything).
  return complete || all ? `${shown} total` : `${shown} shown; no more pages reported`;
}

// Append the invocation's selectors (`--account 2`) to a suggested command, unless the
// command already names them.
export function withSelectors(command, carry = []) {
  const extra = [];
  for (let i = 0; i < carry.length; i += 2) {
    if (!command.includes(carry[i])) extra.push(carry[i], carry[i + 1]);
  }
  return extra.length ? `${command} ${extra.join(" ")}` : command;
}

// Carry the selectors into every `hey-axi …` command quoted inside a text (a hint, a
// string breadcrumb, an error's help line).
export function carrySelectors(text, carry = []) {
  if (typeof text !== "string" || !carry.length) return text;
  if (/^hey-axi \S/.test(text) && !/[`'"]/.test(text)) return withSelectors(text, carry);
  // `…` may contain quotes ("<query>"); '…' and "…" may not contain their own quote.
  let out = text.replace(/`(hey-axi [^`]+)`/g, (match, command) => `\`${withSelectors(command, carry)}\``);
  out = out.replace(/(^|[^`\w])(['"])(hey-axi [^'"`]+?)\2/g, (match, lead, quote, command) => `${lead}${quote}${withSelectors(command, carry)}${quote}`);
  // Unquoted "Run hey-axi …" to the end of the sentence.
  return out.replace(/(\bRun:? )(hey-axi [^`'".;,\n]+?)(?=[.;,]?\s*$|[.;,]\s)/g, (match, run, command) => `${run}${withSelectors(command.trim(), carry)}`);
}

function breadcrumbHelp(crumb, carry) {
  if (typeof crumb === "string") return carrySelectors(heyToAxi(crumb), carry);
  if (!crumb || typeof crumb !== "object" || !crumb.command) return null;
  const description = crumb.description ? ` to ${crumb.description.charAt(0).toLowerCase()}${crumb.description.slice(1)}` : "";
  return `Run \`${withSelectors(heyToAxi(crumb.command), carry)}\`${description}`;
}

// The help line that reveals the rest of a truncated list (AXI principle 9).
// The command line without one flag and its value (`--page 1`, `--page=1`).
function dropFlag(commandLine, name) {
  return commandLine.replace(new RegExp(`\\s--${name}(=\\S+|\\s+(?!-)\\S+)?(?=\\s|$)`, "g"), "");
}

export function moreHelp(size, { commandLine: line, pageFlags = [] }) {
  if (!size.more) return null;
  // The hint replaces paging flags already on the line instead of repeating them.
  const commandLine = dropFlag(dropFlag(line, "page"), "all");
  const all = size.total !== undefined ? `all ${size.total}` : "all of them";
  if (pageFlags.includes("all")) return `Run \`${commandLine} --all\` for ${all}`;
  if (size.next && pageFlags.includes("page")) return `Run \`${commandLine} --page ${size.next}\` for the next page`;
  if (pageFlags.includes("limit")) return `Run \`${dropFlag(commandLine, "limit")} --limit <n>\` to show more`;
  return null;
}

// Shape whatever HEY printed. options: { path, fields, commandLine, carry, pageFlags, quiet }.
//   carry:     selector args from the invocation (["--account", "2"]) for suggested commands
//   pageFlags: which of all/page/limit the command takes, for the "see the rest" hint
//   quiet:     drop HEY's summary, notice, breadcrumbs and meta; keep hey-axi's count,
//              empty state and --full/--all hints
// Returns the object to print.
export function shapeEnvelope(envelope, { path, fields = null, commandLine, carry = [], pageFlags = [], quiet = false, all = false }) {
  const enveloped = envelope && typeof envelope === "object" && !Array.isArray(envelope) && "data" in envelope;
  const body = enveloped ? envelope.data : envelope;
  const { data, truncated, empty } = shapeData(body, { path, fields });
  const found = findList(body);
  const out = {};
  if (enveloped && envelope.ok !== undefined) out.ok = envelope.ok;
  if (enveloped && envelope.summary && !quiet) out.summary = envelope.summary;
  const size = found && !found.lists ? listSize(enveloped ? envelope : null, found.list.length, found.container) : null;
  if (size) out.count = countLine({ ...size, all });
  let multiSize = null;
  if (found?.lists) {
    // Several lists: each one's length, plus whatever HEY says about the whole result.
    multiSize = listSize(enveloped ? envelope : null, found.list.length, found.container);
    const parts = found.lists.map(({ key, list }) => `${list.length} ${key}`).join(", ");
    out.count = multiSize.total !== undefined ? `${parts} (${multiSize.total} total)` : multiSize.more ? `${parts}; more available` : parts;
  }
  const nothing = body === null || body === undefined || (typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 0);
  if (!enveloped && !found && !truncated && !nothing) return data;
  out.data = data;
  const reported = size || multiSize;
  if (empty && reported && (reported.more || reported.total > 0)) {
    // An empty page while HEY reports more is not "nothing".
    out.empty = `0 results on this page for \`${commandLine}\`; HEY reports ${reported.total > 0 ? `${reported.total} in total` : "more"}`;
  } else if (empty) out.empty = `0 results for \`${commandLine}\``;
  else if (nothing && !(enveloped && envelope.summary)) out.empty = `no data returned for \`${commandLine}\``;
  const help = [];
  if (enveloped && !quiet) {
    for (const [key, value] of Object.entries(envelope)) {
      if (["ok", "data", "summary", "meta", "breadcrumbs", "notice"].includes(key)) continue;
      out[key] = value;
    }
    if (envelope.notice) out.notice = carrySelectors(heyToAxi(envelope.notice), carry);
    help.push(...(Array.isArray(envelope.breadcrumbs) ? envelope.breadcrumbs : []).map((crumb) => breadcrumbHelp(crumb, carry)).filter(Boolean));
  }
  const more = (size || multiSize) && moreHelp(size || multiSize, { commandLine, pageFlags });
  if (more) help.push(more);
  if (truncated) help.push(`Run \`${commandLine} --full\` to see complete content`);
  if (CONTENT_LISTS[path] && !fields && !empty && found) help.push(CONTENT_LISTS[path](commandLine, carry));
  if (help.length) out.help = help;
  if (enveloped && !quiet && envelope.meta && typeof envelope.meta === "object") {
    const meta = { ...envelope.meta };
    for (const key of ["total_count", "pages_fetched", "next_page", "next_cursor", "has_more"]) delete meta[key];
    if (Object.keys(meta).length) out.meta = meta;
  }
  return out;
}
