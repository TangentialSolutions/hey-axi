// Deterministic, schema-driven SYNTHETIC fixture generation from HEY's OpenAPI spec
// (basecamp/hey-sdk openapi.json). Every value is made up; shapes come from the spec.

const SUBJECTS = [
  "Q4 planning: agenda and pre-reads", "Your receipt from Linear (#4821)", "Re: Contract redlines for the Acme renewal",
  "Flight confirmation: BOS → SFO, Oct 14", "Weekly product digest — what shipped", "Invoice INV-20931 is due Friday",
  "Re: Can we move our 1:1 to Thursday?", "Your September statement is ready", "Design review notes + next steps",
  "Welcome to the beta!", "Re: Hiring loop for the senior backend role", "Shipping update: your order is on the way",
  "Board deck draft v3", "Reminder: dentist appointment tomorrow at 9:30", "Re: Kitchen remodel quote",
  "New sign-in to your account", "Re: Offsite logistics (hotel block closes 10/10)", "Your weekly running summary",
  "Expense report approved", "Re: Podcast guest invite", "Security alert: new device", "Lunch on Friday?",
  "Re: Quarterly taxes — documents needed", "Conference talk accepted 🎉", "Re: Customer escalation — Globex",
];
const PEOPLE = [
  ["Jane Cooper", "jane@acme.example"], ["Marcus Lee", "marcus.lee@globex.example"], ["Priya Natarajan", "priya@initech.example"],
  ["Linear", "notifications@linear.example"], ["Dana Whitfield", "dana@whitfield.example"], ["Delta Air Lines", "noreply@delta.example"],
  ["Sam Ortiz", "sam@ortiz.example"], ["Chase", "alerts@chase.example"], ["Avery Chen", "avery.chen@acme.example"],
  ["Stripe", "receipts@stripe.example"], ["Noah Brooks", "noah@brooks.example"], ["Strava", "no-reply@strava.example"],
];
const SNIPPETS = [
  "Thanks for sending this over — I left a few comments inline and flagged two open questions for legal.",
  "Here's the summary of what changed this week, plus links to the full release notes and the migration guide.",
  "Just a heads-up that the payment is scheduled for Friday; reply if you need us to adjust the amount or date.",
  "Can we push to Thursday afternoon? Something came up Wednesday and I want to give this the time it deserves.",
  "Attached is the latest draft. The main changes are in sections 3 and 5; everything else is formatting.",
];
const PARAGRAPHS = [
  "Thanks again for making time yesterday. I wanted to follow up with a written summary so everyone who couldn't join has the same context, and so we have something concrete to react to before Thursday.",
  "First, on scope: we agreed to keep the renewal at the current seat count through Q1 and revisit expansion once the new team is onboarded. Finance asked that any change to payment terms go through procurement, so I've looped in Marcus.",
  "Second, on the redlines: legal accepted most of our edits to section 4 (data processing) but pushed back on the uncapped liability language in 9.2. Their proposal is a cap at 2x annual fees, which seems reasonable to me, but I'd like a second opinion before we respond.",
  "Third, timeline. If we can get comments back by end of day Wednesday, they can turn a clean version by Friday and we stay on track for signature before the 15th. If that's too tight, let me know and I'll ask for an extension now rather than later.",
  "A few smaller items: the security questionnaire is done and uploaded to the shared folder; the SOC 2 report is attached; and I've asked support to confirm the SLA numbers we quoted in the proposal match what's in the master agreement.",
  "Let me know if I missed anything. I'll set up a 30-minute call Thursday morning to close out whatever is still open — reply with times that don't work and I'll route around them.",
];

export function resolveRef(spec, schema) {
  let current = schema;
  const seen = new Set();
  while (current && current.$ref) {
    if (seen.has(current.$ref)) return {};
    seen.add(current.$ref);
    current = spec.components.schemas[current.$ref.replace("#/components/schemas/", "")];
  }
  return current || {};
}

function mergeAllOf(spec, schema) {
  if (!schema.allOf) return schema;
  const merged = { type: "object", properties: {}, required: [] };
  for (const part of schema.allOf) {
    const resolved = mergeAllOf(spec, resolveRef(spec, part));
    Object.assign(merged.properties, resolved.properties || {});
    merged.required.push(...(resolved.required || []));
  }
  return merged;
}

export function makeGenerator(spec, options = {}) {
  let counter = 0;
  const next = () => (counter += 1);
  const arrayCounts = options.arrayCounts || {};
  const sparse = new Set(options.sparse || ["extenzions", "workflows", "collections", "folders", "updates_channels", "attachments", "blocked_senders"]);
  const longText = options.longText || false;

  const plural = (ctx) => `${(ctx || "topic").replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase()}s`;

  function stringFor(name, schema, path, ctx) {
    const n = name.toLowerCase();
    const i = next();
    if (schema.enum) return schema.enum[0];
    if (schema.format === "date-time" || n.endsWith("_at")) return `2026-09-${String(10 + (i % 18)).padStart(2, "0")}T${String(8 + (i % 10)).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}:00Z`;
    if (schema.format === "date" || n.endsWith("_on") || n === "date" || n === "day") return `2026-09-${String(28 + (i % 3)).padStart(2, "0")}`;
    if (n.includes("email")) return PEOPLE[i % PEOPLE.length][1];
    if (n.endsWith("url")) {
      const resource = `https://app.hey.com/${plural(ctx)}/${1000000 + i}`;
      if (n === "app_url") return resource;
      if (n === "url") return `${resource}.json`;
      return `${resource}/${n.replace(/_url$/, "").replace(/_/g, "-")}`;
    }
    if (n.includes("token") || n.includes("signed") || n.includes("stream")) return `eyJfcmFpbHMiOnsiZGF0YSI6WyJ${i}`;
    if (n === "name" && ["Topic", "Posting", "SearchTopic"].includes(ctx)) return SUBJECTS[i % SUBJECTS.length];
    if (n === "subject" || n === "title" || n === "topic_title") return SUBJECTS[i % SUBJECTS.length];
    if (n === "summary" || n.includes("snippet") || n.includes("preview") || n === "excerpt") return SNIPPETS[i % SNIPPETS.length];
    if (n.includes("html") || n === "body" || n === "content" || n === "content_html" || n === "description" || n === "notes") {
      if (!longText) return SNIPPETS[i % SNIPPETS.length];
      return PARAGRAPHS.map((p) => `<p>${p}</p>`).join("\n");
    }
    if (n === "initials") return PEOPLE[i % PEOPLE.length][0].split(" ").map((w) => w[0]).join("");
    if (n.includes("color")) return "#5B8DEF";
    if (n.includes("time_zone") || n === "timezone") return "America/New_York";
    if (n === "name" || n.endsWith("_name") || n === "alias") return PEOPLE[i % PEOPLE.length][0];
    if (n === "kind" || n.endsWith("_kind") || n.endsWith("_type") || n === "type") return schema.description?.match(/"([a-z_]+)"/)?.[1] || "topic";
    return `${name}-${i}`;
  }

  function value(schema, name, path, depth, ctx) {
    if (schema && schema.$ref) ctx = schema.$ref.split("/").pop();
    schema = mergeAllOf(spec, resolveRef(spec, schema));
    if (schema.oneOf || schema.anyOf) return value((schema.oneOf || schema.anyOf)[0], name, path, depth, ctx);
    const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== "null") : schema.type;
    if (type === "array") {
      const count = arrayCounts[path] ?? arrayCounts[name] ?? (sparse.has(name) ? 0 : 1);
      if (depth > 6) return [];
      return Array.from({ length: count }, () => value(schema.items || {}, name, path, depth + 1, ctx));
    }
    if (type === "object" || schema.properties) {
      if (depth > 6) return {};
      const out = {};
      for (const [key, prop] of Object.entries(schema.properties || {})) {
        if (prop.deprecated) continue;
        out[key] = value(prop, key, path ? `${path}.${key}` : key, depth + 1, ctx);
      }
      return out;
    }
    if (type === "integer") {
      const n = name.toLowerCase();
      if (n === "id" || n.endsWith("_id")) return 1000000 + next() * 37;
      if (n.includes("count") || n.includes("total")) return 3;
      return 1;
    }
    if (type === "number") return 1.5;
    if (type === "boolean") return (next() % 4) === 0;
    return stringFor(name, schema, path, ctx);
  }

  // Make each contact internally consistent (name ↔ email ↔ initials).
  function harmonize(node) {
    if (Array.isArray(node)) node.forEach(harmonize);
    else if (node && typeof node === "object") {
      const person = PEOPLE.find(([name]) => name === node.name);
      if (person && "email_address" in node) node.email_address = person[1];
      if (person && "initials" in node) node.initials = person[0].split(" ").map((w) => w[0]).join("");
      Object.values(node).forEach(harmonize);
    }
    return node;
  }

  return (schema) => harmonize(value(schema, "", "", 0, undefined));
}

// Map a request path (e.g. /topics/123/entries.json) to an OpenAPI GET operation.
export function matchRoute(spec, requestPath) {
  const clean = requestPath.split("?")[0].replace(/\.json$/, "");
  for (const [template, item] of Object.entries(spec.paths)) {
    if (!item.get) continue;
    const pattern = new RegExp(`^${template.replace(/\.json$/, "").replace(/\{[^}]+\}/g, "[^/]+")}$`);
    if (pattern.test(clean)) return { template, operation: item.get };
  }
  return null;
}

export function responseSchema(operation) {
  return operation.responses?.["200"]?.content?.["application/json"]?.schema || null;
}
