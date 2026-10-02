// Command-line parsing that knows which HEY flags take a value, so global flags such as
// `--account 5` can appear anywhere (before, between, or after the command words)
// without their values being mistaken for command words.

// HEY's persistent (global) flags, from `hey --help`. Only these three take a value.
export const GLOBAL_VALUE_FLAGS = ["account", "jq", "base-url"];
export const GLOBAL_BOOLEAN_FLAGS = ["json", "quiet", "ids-only", "count", "markdown", "styled", "html", "stats", "verbose", "help"];
export const GLOBAL_SHORTHANDS = ["-v", "-h"];

// hey-axi's own flags. Never forwarded to HEY.
export const AXI_BOOLEAN_FLAGS = ["allow-send", "allow-secret", "full"];
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

// Split argv into positional words (for routing) and flag names (for mode selection).
// The argv itself is never reordered: HEY (cobra) accepts flags anywhere.
export function scanArgs(argv, valueFlags) {
  const words = [];
  const flags = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      words.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("-") && arg !== "-") {
      const [name] = arg.split("=", 1);
      flags.add(name);
      if (!arg.includes("=") && valueFlags.has(name)) i += 1;
      continue;
    }
    words.push(arg);
  }
  return { words, flags };
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
  return `--${flag.name}${short}${flag.value ? " <value>" : ""}`;
}

// AXI: reject unknown flags (and missing required ones) before HEY is ever called.
// Returns null, or { unknown: [...] } / { missing: [...] }.
export function validateFlags(node, flags) {
  const allowed = new Set([
    ...[...GLOBAL_VALUE_FLAGS, ...GLOBAL_BOOLEAN_FLAGS, ...AXI_BOOLEAN_FLAGS, ...AXI_VALUE_FLAGS].map((name) => `--${name}`),
    ...GLOBAL_SHORTHANDS,
  ]);
  for (const flag of node.flags || []) {
    allowed.add(`--${flag.name}`);
    if (flag.shorthand) allowed.add(`-${flag.shorthand}`);
  }
  const unknown = [...flags].map(flagName).filter((flag) => !allowed.has(flag));
  if (unknown.length) return { unknown: [...new Set(unknown)] };
  if (flags.has("--help") || flags.has("-h")) return null;
  const missing = (node.flags || [])
    .filter((flag) => /\(required\)$/.test(flag.desc || ""))
    .filter((flag) => !flags.has(`--${flag.name}`) && !(flag.shorthand && flags.has(`-${flag.shorthand}`)))
    .map((flag) => `--${flag.name}`);
  return missing.length ? { missing } : null;
}
