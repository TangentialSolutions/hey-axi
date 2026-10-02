// Shape HEY's JSON envelope for agents (AXI principles 2-5 and 9):
//   - minimal default fields per list command, `--fields a,b,c` to choose, `--fields all`
//   - long text truncated with its total size, `--full` to get HEY's output untouched
//   - a definitive `empty` line for empty lists, `count: N of T total` when HEY knows T
//   - HEY's breadcrumbs as `help` lines that name hey-axi commands
import { heyToAxi } from "./text.js";

// A field is "key" or "key=path", where path is dotted (`creator.name`), may index an
// array (`messages.0.creator.name`), may map over one (`recipients.to[].email_address`,
// joined with ", "), and may list fallbacks (`name|subject`).
const POSTINGS = ["id", "topic_id", "from=creator.name|sender.name|alternative_sender_name", "subject=name|subject", "seen", "at=active_at|created_at|updated_at"];
const EVENTS = ["id", "title", "starts_at", "ends_at", "calendar=calendar.name"];
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
  "bubble list": [...POSTINGS, "bubbles_up=bubble_up_schedule.bubble_up_at"],
  "box list": ["id", "kind", "name"],
  search: ["id", "topic_id", "subject", "from=messages.0.creator.name|creator.name", "at=updated_at|created_at"],
  "screener list": ["id", "name", "email_address", "subject", "topic_id"],
  "screener history": ["id", "status", "name=name|petitioner.name", "email_address=email_address|petitioner.email_address", "decided=decided|updated_at"],
  "event list": EVENTS,
  "event day": EVENTS,
  "event week": EVENTS,
  "todo list": ["id", "title", "starts_at", "completed_at"],
  "habit list": ["id", "title=title|name", "days"],
  "journal list": ["id", "starts_at", "content"],
  "draft list": ["id", "subject", "summary", "at=updated_at|created_at"],
  "contact list": ["id", "name", "email_address"],
  "label list": NAMED,
  "collection list": NAMED,
  "workflow list": NAMED,
  "calendar list": ["id", "name", "kind", "owned"],
  "attachment list": ["id", "filename", "content_type", "byte_size"],
  "clip list": ["id", "content", "topic_id", "at=created_at"],
  "snippet list": ["id", "name", "content"],
  "timetrack list": ["id", "starts_at", "ends_at", "category", "notes"],
  "timetrack categories": ["id", "title"],
  "account list": ["id", "email=email|email_address", "name", "active"],
  "set-aside group list": ["id", "thread_count"],
};

// Detail views keep their long text (truncated), but drop URLs and duplicated fields.
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

// Fields for a list without a declared schema: up to five familiar keys.
function heuristicFields(items) {
  const keys = new Set(items.flatMap((item) => (item && typeof item === "object" ? Object.keys(item) : [])));
  if (keys.size <= 5) return null;
  const picked = HEURISTIC_KEYS.filter((key) => keys.has(key)).slice(0, 5);
  return picked.length >= 2 ? picked : null;
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
const DROP_CONTAINER_KEY = (key) => /(^|_)url$|^signed_stream_name$/.test(key);

// Find the collection in HEY's `data`: the array itself, or the one array of objects
// inside a container object (e.g. a box with its postings).
export function findList(data) {
  if (isObjectList(data)) return { list: data };
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const keys = Object.keys(data).filter((key) => isObjectList(data[key]));
    if (keys.length === 1) return { list: data[keys[0]], key: keys[0], container: data };
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
      else if (fields === "all" || (!DROP_CONTAINER_KEY(name) && (value === null || typeof value !== "object"))) {
        shaped[name] = truncateDeep(value, DETAIL_TEXT_LIMIT, mark);
      }
    }
  }
  return { data: shaped, truncated, empty: list.length === 0 };
}

function breadcrumbHelp(crumb) {
  if (typeof crumb === "string") return heyToAxi(crumb);
  if (!crumb || typeof crumb !== "object" || !crumb.command) return null;
  const description = crumb.description ? ` to ${crumb.description.charAt(0).toLowerCase()}${crumb.description.slice(1)}` : "";
  return `Run \`${heyToAxi(crumb.command)}\`${description}`;
}

// Shape a whole HEY envelope. options: { path, fields, commandLine }.
// Returns the object to print.
export function shapeEnvelope(envelope, { path, fields = null, commandLine }) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || !("data" in envelope)) {
    // Not an envelope (some commands answer with a bare object): just keep it short.
    let truncated = false;
    const data = truncateDeep(envelope, DETAIL_TEXT_LIMIT, () => { truncated = true; });
    if (!truncated) return data;
    const help = [`Run \`${commandLine} --full\` to see complete content`];
    return data && typeof data === "object" && !Array.isArray(data) ? { ...data, help } : { data, help };
  }

  const { data, truncated, empty } = shapeData(envelope.data, { path, fields });
  const out = {};
  if (envelope.ok !== undefined) out.ok = envelope.ok;
  if (envelope.summary) out.summary = envelope.summary;
  const meta = envelope.meta && typeof envelope.meta === "object" ? { ...envelope.meta } : null;
  if (meta && typeof meta.total_count === "number") {
    const found = findList(envelope.data);
    const shown = found ? found.list.length : 0;
    out.count = `${shown} of ${meta.total_count} total`;
    delete meta.total_count;
  }
  if (meta) delete meta.pages_fetched;
  out.data = data;
  if (empty) out.empty = `0 results for \`${commandLine}\``;
  for (const [key, value] of Object.entries(envelope)) {
    if (["ok", "data", "summary", "meta", "breadcrumbs", "notice"].includes(key)) continue;
    out[key] = value;
  }
  if (envelope.notice) out.notice = heyToAxi(envelope.notice);
  const help = (Array.isArray(envelope.breadcrumbs) ? envelope.breadcrumbs : []).map(breadcrumbHelp).filter(Boolean);
  if (truncated) help.push(`Run \`${commandLine} --full\` to see complete content`);
  if (help.length) out.help = help;
  if (meta && Object.keys(meta).length) out.meta = meta;
  return out;
}
