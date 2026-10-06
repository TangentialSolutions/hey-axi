// Command-line parsing that knows which HEY flags take a value, so global flags such as
// `--account 5` can appear anywhere (before, between, or after the command words)
// without their values being mistaken for command words.

// HEY's persistent (global) flags, from `hey --help`. Only these three take a value.
export const GLOBAL_VALUE_FLAGS = ["account", "jq", "base-url"];
export const GLOBAL_BOOLEAN_FLAGS = ["json", "quiet", "ids-only", "count", "markdown", "styled", "html", "stats", "verbose", "help"];
export const GLOBAL_SHORTHANDS = ["-v", "-h"];

// hey-axi's own flags. Never forwarded to HEY.
export const AXI_BOOLEAN_FLAGS = ["allow-send", "allow-secret", "full", "interactive"];
export const AXI_VALUE_FLAGS = ["fields"];

// Output selectors that make HEY print something other than a JSON envelope. When any is
// present, hey-axi hands the command to HEY untouched and prints HEY's output as-is.
export const RAW_OUTPUT_FLAGS = ["ids-only", "count", "markdown", "html", "styled", "jq"];

export function valueFlagSet(commands) {
  const names = new Set([...GLOBAL_VALUE_FLAGS, ...AXI_VALUE_FLAGS].map((name) => `--${name}`));
  const walk = (nodes) => {
    for (const node of nodes || []) {
      for (const flag of node.flags || []) {
        if (!flag.value) continue;
        names.add(`--${flag.name}`);
        if (flag.shorthand) names.add(`-${flag.shorthand}`);
      }
      walk(node.subcommands);
    }
  };
  walk(commands);
  return names;
}

// Split argv into positional words (for routing and arity) and flag names (for mode
// selection). Also returns each flag's value and the value flags that are missing one
// (`--limit` at the end, or followed by another flag). The argv itself is never
// reordered: HEY (cobra) accepts flags anywhere.
export function scanArgs(argv, valueFlags) {
  const words = [];
  const flags = new Set();
  const values = [];
  const missing = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      words.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("-") && arg !== "-") {
      // Shorthand with its value attached (`-mhi`) or stacked shorthands (`-vv`).
      if (/^-[A-Za-z]./.test(arg) && !arg.startsWith("--")) {
        // Each letter is a shorthand until one takes a value; the rest is its value.
        // Every letter is recorded, so an unknown one (`-vZ`) is rejected by name.
        for (let j = 1; j < arg.length; j += 1) {
          const name = `-${arg[j]}`;
          if (arg[j] === "=") {
            values.push([`-${arg[j - 1]}`, arg.slice(j + 1)]);
            break;
          }
          flags.add(name);
          if (valueFlags.has(name)) {
            values.push([name, arg.slice(arg[j + 1] === "=" ? j + 2 : j + 1)]);
            break;
          }
        }
        continue;
      }
      const eq = arg.indexOf("=");
      const name = eq === -1 ? arg : arg.slice(0, eq);
      flags.add(name);
      if (eq !== -1) values.push([name, arg.slice(eq + 1)]);
      else if (valueFlags.has(name)) {
        const next = argv[i + 1];
        if (next === undefined || looksLikeFlag(next)) missing.push(name);
        else {
          values.push([name, next]);
          i += 1;
        }
      }
      continue;
    }
    words.push(arg);
  }
  return { words, flags, values, missing: [...new Set(missing)] };
}

// "-5" and "-" are values; "--to" and "-m" are flags.
function looksLikeFlag(arg) {
  return arg === "--" || (arg.startsWith("-") && arg !== "-" && !/^-\d/.test(arg));
}

// The value flags of one command, plus the global and hey-axi ones.
export function nodeValueFlags(node) {
  return valueFlagSet(node ? [{ flags: node.flags }] : []);
}

export function hasAny(flags, names) {
  return names.some((name) => flags.has(`--${name}`));
}

// Remove hey-axi's own flags (and the value of --fields) from argv, keeping order.
export function stripAxiFlags(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      out.push(...argv.slice(i));
      break;
    }
    const [name] = arg.split("=", 1);
    if (AXI_BOOLEAN_FLAGS.some((flag) => name === `--${flag}`)) continue;
    if (AXI_VALUE_FLAGS.some((flag) => name === `--${flag}`)) {
      if (!arg.includes("=")) i += 1;
      continue;
    }
    out.push(arg);
  }
  return out;
}

// Value of a value flag (`--fields a,b` or `--fields=a,b`); the last one wins.
export function flagValue(argv, name) {
  let value;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--") break;
    if (argv[i] === `--${name}`) value = argv[i + 1];
    else if (argv[i].startsWith(`--${name}=`)) value = argv[i].slice(name.length + 3);
  }
  return value;
}

const flagName = (flag) => (flag.startsWith("--") ? flag : flag.slice(0, 2));

export function flagLabel(flag) {
  const short = flag.shorthand ? `, -${flag.shorthand}` : "";
  return `--${flag.name}${short}${flag.value ? ` <${flag.type || "value"}>` : ""}`;
}

const GLOBAL_TYPES = { "--account": "string", "--jq": "string", "--base-url": "string", "--fields": "string" };
const GO_DURATION = /^(0|([0-9]+(\.[0-9]+)?(ns|us|µs|ms|s|m|h))+)$/;

function typeError(name, type, value) {
  if (type === "int" && !/^-?\d+$/.test(value)) return `${name} needs a whole number, got "${value}"`;
  if (type === "duration" && !GO_DURATION.test(value)) return `${name} needs a duration such as 30s, 10m or 1h, got "${value}"`;
  // A switch is on when present and off when absent; an explicit value (`--draft=false`)
  // is refused so that what hey-axi's policy sees is exactly what HEY would do.
  if (type === "bool") return `${name} is a switch and takes no value: pass ${name} to turn it on, or leave it out (got ${name}=${value})`;
  if (type === "count" && !/^\d+$/.test(value)) return `${name} counts repeats (${name} ${name}) or takes a whole number, got "${value}"`;
  return null;
}

// Rules HEY enforces itself but its catalog doesn't mark (no "(required)" in the flag's
// description, no list of values), so hey-axi can fail loud before HEY runs:
//   required: flags the command can't run without
//   choices:  the only values a flag takes
//   together: flags that are only meaningful with each other
export const FLAG_RULES = {
  "contact deliver": { required: ["--to"], choices: { "--to": ["imbox", "feed", "papertrail", "screened-out"] } },
  "event delete": { choices: { "--apply-to": ["current", "future"] }, together: [["--occurrence", "--apply-to"]] },
  "event edit": { choices: { "--apply-to": ["current", "future"] }, together: [["--occurrence", "--apply-to"]] },
};

// Every required flag of a command: marked "(required)" by HEY, or listed in FLAG_RULES.
export function requiredFlags(node) {
  const marked = (node.flags || []).filter((flag) => /\(required\)$/.test(flag.desc || "")).map((flag) => `--${flag.name}`);
  return [...new Set([...marked, ...(FLAG_RULES[node.path]?.required || [])])];
}

// AXI: reject unknown flags, flags without their value, values of the wrong type and
// missing required flags before HEY is ever called.
// Returns null, or { unknown } / { missingValue } / { badValue } / { missing }.
export function validateFlags(node, flags, { values = [], missingValues = [] } = {}) {
  const allowed = new Set([
    ...[...GLOBAL_VALUE_FLAGS, ...GLOBAL_BOOLEAN_FLAGS, ...AXI_BOOLEAN_FLAGS, ...AXI_VALUE_FLAGS].map((name) => `--${name}`),
    ...GLOBAL_SHORTHANDS,
  ]);
  const types = new Map(Object.entries(GLOBAL_TYPES));
  for (const name of [...GLOBAL_BOOLEAN_FLAGS, ...AXI_BOOLEAN_FLAGS]) types.set(`--${name}`, "bool");
  for (const flag of node.flags || []) {
    allowed.add(`--${flag.name}`);
    if (flag.shorthand) allowed.add(`-${flag.shorthand}`);
    const type = flag.value ? flag.type || "string" : flag.type === "count" ? "count" : "bool";
    types.set(`--${flag.name}`, type);
    if (flag.shorthand) types.set(`-${flag.shorthand}`, type);
  }
  const unknown = [...flags].map(flagName).filter((flag) => !allowed.has(flag));
  if (unknown.length) return { unknown: [...new Set(unknown)] };
  if (flags.has("--help") || flags.has("-h")) return null;
  if (missingValues.length) return { missingValue: missingValues };
  for (const [name, value] of values) {
    const problem = typeError(name, types.get(name), value);
    if (problem) return { badValue: problem };
  }
  const rules = FLAG_RULES[node.path] || {};
  for (const [name, value] of values) {
    const choices = rules.choices?.[name];
    if (choices && !choices.includes(value)) return { badValue: `${name} takes one of ${choices.join(", ")}, got "${value}"` };
  }
  const shorthandOf = (name) => (node.flags || []).find((flag) => `--${flag.name}` === name)?.shorthand;
  const given = (name) => flags.has(name) || (shorthandOf(name) && flags.has(`-${shorthandOf(name)}`));
  const missing = requiredFlags(node).filter((name) => !given(name));
  if (missing.length) return { missing };
  for (const group of rules.together || []) {
    const present = group.filter(given);
    if (present.length && present.length < group.length) {
      const absent = group.filter((name) => !given(name));
      return { badValue: `${present.join(" and ")} needs ${absent.join(" and ")} for \`${node.path}\` (pass ${group.join(" and ")} together)` };
    }
  }
  return null;
}
