// Command-line parsing that knows which HEY flags take a value, so global flags such as
// `--account 5` can appear anywhere (before, between, or after the command words)
// without their values being mistaken for command words.

// HEY's persistent (global) flags, from `hey --help`. Only these three take a value.
export const GLOBAL_VALUE_FLAGS = ["account", "jq", "base-url"];

// Output selectors that make HEY print something other than a JSON envelope. When any is
// present, hey-axi hands the command to HEY untouched and prints HEY's output as-is.
export const RAW_OUTPUT_FLAGS = ["ids-only", "count", "markdown", "html", "styled", "jq"];

export function valueFlagSet(commands) {
  const names = new Set(GLOBAL_VALUE_FLAGS.map((name) => `--${name}`));
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
