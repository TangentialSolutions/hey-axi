#!/usr/bin/env node
// Generate SYNTHETIC HEY API responses (what app.hey.com would return) from HEY's
// OpenAPI spec, for the token benchmark's mock server.
//
//   HEY_SDK_OPENAPI=/path/to/hey-sdk/openapi.json node bench/generate-api-fixtures.mjs
//
// The spec is basecamp/hey-sdk's openapi.json at tag go/v0.31.1 (the SDK version HEY
// CLI v1.7.0 is built against). Shapes come from the spec; every value is invented.
// A few per-endpoint "shapers" make the payloads look like a real account (boxes with
// real kinds, a Labels navigation group, calendar recordings keyed by type), because
// the CLI interprets those fields. Output: bench/api-fixtures/*.json + index.json.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { makeGenerator, resolveRef, responseSchema } from "./lib/schema-fixtures.mjs";

const specPath = process.env.HEY_SDK_OPENAPI;
if (!specPath) {
  console.error("Set HEY_SDK_OPENAPI to basecamp/hey-sdk's openapi.json (tag go/v0.31.1).");
  process.exit(2);
}
const spec = JSON.parse(readFileSync(specPath, "utf8"));
const outDir = fileURLToPath(new URL("./api-fixtures/", import.meta.url));
mkdirSync(outDir, { recursive: true });

const operations = {};
for (const [template, item] of Object.entries(spec.paths)) {
  if (item.get) operations[item.get.operationId] = { template, operation: item.get };
}
const schemaOf = (operationId) => responseSchema(operations[operationId].operation);
const component = (name) => ({ $ref: `#/components/schemas/${name}` });
const pick = (object, keys) => Object.fromEntries(keys.filter((key) => key in object).map((key) => [key, object[key]]));

const BOX_KINDS = [["imbox", "Imbox"], ["feed", "The Feed"], ["paper_trail", "Paper Trail"], ["set_aside", "Set Aside"], ["reply_later", "Reply Later"], ["trailbox", "Bubble Up"]];
const LABELS = ["Receipts", "Travel", "Taxes 2026", "Kids' school", "Clients/Acme", "Clients/Globex", "Newsletters", "Follow up"];
const EVENTS = [["Team standup", "09:30", "09:45"], ["Design review", "11:00", "12:00"], ["Lunch with Marcus", "12:30", "13:30"], ["1:1 with Priya", "15:00", "15:30"], ["Dentist", "08:30", "09:15"], ["Board prep", "14:00", "15:30"], ["Soccer practice (kids)", "17:30", "18:30"]];
const TODOS = ["Renew passport", "Send W-9 to Acme", "Book hotel for offsite", "Review Q4 budget", "Call plumber", "Pick up dry cleaning", "Reply to Dana about contract", "Order birthday gift"];

const fixtures = {};
function emit(operationId, body, note) {
  fixtures[operationId] = { template: operations[operationId].template, file: `${operationId}.json`, note };
  writeFileSync(`${outDir}${operationId}.json`, `${JSON.stringify(body, null, 1)}\n`);
}

// box list
{
  const gen = makeGenerator(spec);
  emit("ListBoxes", BOX_KINDS.map(([kind, name], index) => ({ ...gen(component("Box")), id: 7000 + index, kind, name, app_url: `https://app.hey.com/${kind.replace("_", "-")}` })), "6 standard boxes");
}

// box view imbox: a full first page of 25 postings
{
  const gen = makeGenerator(spec, { arrayCounts: { postings: 25, contacts: 2, addressed_contacts: 1 } });
  const box = gen(schemaOf("GetImbox"));
  Object.assign(box, { id: 7000, kind: "imbox", name: "Imbox", app_url: "https://app.hey.com/imbox" });
  box.postings.forEach((posting, index) => {
    const id = 50000 + index;
    Object.assign(posting, { id, kind: "topic", box_id: 7000, seen: index % 3 !== 0, app_url: `https://app.hey.com/topics/${id}`, visible_entry_count: 1 + (index % 4) });
    // Optional extras appear on a few postings, not all of them.
    if (index % 8 !== 0) delete posting.note;
    if (index % 6 !== 0) delete posting.bubble_up_schedule;
    if (index % 5 !== 0) delete posting.alternative_sender_name;
  });
  emit("GetImbox", box, "Imbox, first page: 25 postings");
}

// thread read: a 4-message thread; each message body is a long HTML email
{
  const gen = makeGenerator(spec, { arrayCounts: { "": 4 } });
  const entries = gen(schemaOf("GetTopicEntries")).map((entry, index) => ({ ...entry, id: 61000 + index, topic_id: 50000, kind: "message", subject: "Re: Contract redlines for the Acme renewal", app_url: `https://app.hey.com/topics/50000#entry_${61000 + index}` }));
  emit("GetTopicEntries", entries, "4 entries in one thread");
  const mgen = makeGenerator(spec, { longText: true, arrayCounts: { received_via: 0 } });
  const message = mgen(component("Message"));
  Object.assign(message, { subject: "Re: Contract redlines for the Acme renewal", is_reply: true });
  message.content = `<div class="trix-content">${message.content}\n<blockquote><p>On Sep 28, 2026, Marcus Lee wrote:</p><p>Looping in legal. Can we get comments back by Wednesday? The redlined PDF is attached.</p></blockquote></div>`;
  emit("GetMessage", message, "One long HTML message (served for every message ID)");
}

// label list: HEY's navigation payload, with a "Labels" group of folders
{
  const gen = makeGenerator(spec, { arrayCounts: { items: 6, menu_items: 0, hotkeys: 4 } });
  const nav = gen(schemaOf("GetNavigation"));
  const labelsGroup = nav.items[0];
  Object.assign(labelsGroup, { title: "Labels", app_url: "https://app.hey.com/folders" });
  labelsGroup.icon = { ...labelsGroup.icon, name: "folders" };
  labelsGroup.menu_items = LABELS.map((title, index) => ({ ...gen(component("NavigationItem")), title, app_url: `https://app.hey.com/folders/${8100 + index}`, menu_items: [] }));
  ["Imbox", "The Feed", "Paper Trail", "Set Aside", "Reply Later"].forEach((title, index) => Object.assign(nav.items[index + 1], { title, menu_items: [] }));
  emit("GetNavigation", nav, "Navigation with a Labels group of 8 labels");
}

// screener list: 8 first-time senders waiting
{
  const gen = makeGenerator(spec, { arrayCounts: { clearances: 8 } });
  const summary = gen(schemaOf("GetClearances"));
  summary.pending_clearances_count = 8;
  summary.clearances.forEach((clearance, index) => Object.assign(clearance, { id: 9100 + index, status: "pending" }));
  emit("GetClearances", summary, "8 pending Screener clearances");
}

// calendars + event week + todo list
{
  const gen = makeGenerator(spec, { arrayCounts: { calendars: 2, selected_calendar_ids: 2, reminders: 1, attendances: 2 } });
  const calendars = gen(schemaOf("ListCalendars"));
  calendars.calendars.forEach((calendar, index) => Object.assign(calendar, { id: 3000 + index, name: index ? "Family" : "Personal", kind: "personal", owned: true, personal: index === 0, external: false }));
  calendars.selected_calendar_ids = [3000, 3001];
  emit("ListCalendars", calendars, "2 calendars");

  const recording = (fields, extra) => ({ ...pick(gen(component("Recording")), fields), ...extra });
  const EVENT_FIELDS = ["id", "title", "all_day", "recurring", "starts_at", "ends_at", "created_at", "updated_at", "type", "starts_at_time_zone", "ends_at_time_zone", "reminders_label", "calendar", "url", "edit_url", "occurrences_url", "location", "description", "join_link", "organizer", "attendances_summary"];
  const days = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"];
  const events = [];
  days.forEach((day, d) => EVENTS.slice(0, 2 + (d % 3)).forEach(([title, start, end], e) => {
    events.push(recording(EVENT_FIELDS, { id: 4000 + d * 10 + e, type: "Calendar::Event", title, all_day: false, recurring: title === "Team standup", starts_at: `${day}T${start}:00-04:00`, ends_at: `${day}T${end}:00-04:00`, calendar: { id: 3000, name: "Personal" } }));
  }));
  const week = gen(schemaOf("GetCalendarWeek"));
  Object.assign(week, { kind: "week", starts_at: "2026-09-27T00:00:00-04:00", ends_at: "2026-10-04T00:00:00-04:00", recordings: { "Calendar::Event": events } });
  emit("GetCalendarWeek", week, `${events.length} events in one week`);

  const TODO_FIELDS = ["id", "title", "starts_at", "completed_at", "created_at", "updated_at", "type", "calendar", "url", "edit_url", "position"];
  const todos = TODOS.map((title, index) => recording(TODO_FIELDS, { id: 5000 + index, type: "Calendar::Todo", title, starts_at: `2026-10-0${1 + (index % 5)}T00:00:00-04:00`, completed_at: null, position: index + 1, calendar: { id: 3000, name: "Personal" } }));
  emit("GetCalendarRecordings", { "Calendar::Todo": todos }, `${todos.length} open todos`);
}

// search: one page of 20 matches
{
  const gen = makeGenerator(spec, { arrayCounts: { matches: 20, entries: 1 } });
  const result = gen(schemaOf("AdvancedSearch"));
  result.matches.forEach((match, index) => {
    match.posting_id = 52000 + index;
    if (match.topic) Object.assign(match.topic, { id: 50100 + index });
  });
  emit("AdvancedSearch", result, "20 search matches (one page)");
}

writeFileSync(`${outDir}index.json`, `${JSON.stringify({ source: "basecamp/hey-sdk openapi.json @ go/v0.31.1", synthetic: true, fixtures }, null, 1)}\n`);
console.log(`wrote ${Object.keys(fixtures).length} synthetic API fixtures to ${outDir}`);
