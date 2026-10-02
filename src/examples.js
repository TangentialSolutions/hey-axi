// Per-command help details (AXI principle 10): every flag's default, and two or three
// usage examples for every command. HEY's own examples come first; commands HEY gives
// fewer than two for get examples built from their USAGE line and flags.

import { heyToAxi } from "./text.js";
import { patternsFor } from "./arity.js";
import { LIST_FIELDS, parseField } from "./shape.js";

// "(default …)" text for one flag, including zero, false and empty defaults.
export function flagDefault(flag) {
  const value = flag.default;
  if (!flag.value) return `default ${value === "true" ? "true" : "false"}`;
  if (value === undefined || value === "" || value === "[]") return "default: none";
  if (flag.name === "limit" && value === "0") return "default 0: no limit set, HEY returns its first page";
  if (value === "0s") return "default 0s: no timeout";
  return `default ${value}`;
}

const placeholder = (flag) => {
  if (flag.type === "int") return "10";
  if (flag.type === "duration") return "10m";
  return `<${flag.name}>`;
};

function synthesized(node) {
  const pattern = patternsFor(node)[0];
  const args = (pattern?.args || []).filter((arg) => arg.required).map((arg) => `<${arg.name}>`);
  const oneOf = pattern?.oneOf?.[0]?.[0];
  const fromHey = (node.examples || [])[0];
  const base = fromHey ? heyToAxi(fromHey) : ["hey-axi", node.path, ...args, ...(oneOf ? [oneOf] : [])].join(" ");
  const out = [base];
  const own = (node.flags || []).filter((flag) => !(pattern?.oneOf || []).flat().includes(`--${flag.name}`));
  const valued = own.find((flag) => flag.value && !/\(required\)$/.test(flag.desc || ""));
  const required = own.filter((flag) => /\(required\)$/.test(flag.desc || ""));
  if (required.length && !fromHey) {
    out[0] = `${base} ${required.map((flag) => `--${flag.name} ${placeholder(flag)}`).join(" ")}`;
  }
  if (valued && !out[0].includes(`--${valued.name}`)) out.push(`${out[0]} --${valued.name} ${placeholder(valued)}`);
  const list = LIST_FIELDS[node.path];
  if (list) out.push(`${out[0]} --fields ${list.slice(0, 2).map((spec) => parseField(spec).key).join(",")}`);
  out.push(`${out[0]} --json`);
  out.push(`${out[0]} --account <id>`);
  return out;
}

// Two or three examples, HEY's own first.
export function examplesFor(node) {
  const examples = (node.examples || []).map(heyToAxi);
  for (const example of synthesized(node)) {
    if (examples.length >= 3 || (examples.length >= 2 && (node.examples || []).length >= 2)) break;
    if (!examples.includes(example)) examples.push(example);
  }
  return examples.slice(0, 3);
}
