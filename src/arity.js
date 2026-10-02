// Positional-argument checks from HEY's own USAGE lines (bundled in src/manifest.json),
// so a missing id or a stray extra word fails loud (exit 2) before HEY runs.
//
//   hey thread read <thread-id> [flags]            one required argument
//   hey seen <box-item-id>... [flags]              one or more
//   hey journal write [date] [content] [flags]     up to two, both optional
//   hey bubble up <id>... (--now | --on <date> | --tomorrow) [flags]
//                                                  plus exactly one of those flags

// Parse one USAGE line. Returns null for group lines (`hey box <command> [flags]`).
export function parseSynopsis(line, path) {
  const prefix = `hey ${path}`;
  if (!line.startsWith(prefix)) return null;
  let rest = line.slice(prefix.length);
  const oneOf = [];
  rest = rest.replace(/\(([^)]*)\)/g, (_, group) => {
    oneOf.push(group.split("|").map((part) => part.trim().split(/\s+/)[0]).filter((flag) => flag.startsWith("-")));
    return " ";
  });
  const args = [];
  for (const token of rest.trim().split(/\s+/).filter(Boolean)) {
    if (token === "[flags]") continue;
    if (token === "<command>") return null;
    const match = token.match(/^([<[])([^>\]]+)[>\]](\.\.\.)?$/);
    if (!match) continue;
    args.push({ name: match[2], required: match[1] === "<", variadic: Boolean(match[3]) });
  }
  return { args, oneOf };
}

// Every argument pattern that applies when `node` is run with leftover words.
// A group run by its shortcut (`box imbox`) uses HEY's compatibility usage.
export function patternsFor(node) {
  const lines = [...(node.synopsis || [])];
  if (node.usage) lines.push(`hey ${node.usage}`);
  return lines.map((line) => parseSynopsis(line, node.path)).filter(Boolean);
}

const describe = (args) => args.map(({ name, required, variadic }) => `${required ? `<${name}>` : `[${name}]`}${variadic ? "..." : ""}`).join(" ");

function fits(pattern, count) {
  const min = pattern.args.filter((arg) => arg.required).length;
  const max = pattern.args.some((arg) => arg.variadic) ? Infinity : pattern.args.length;
  return count >= min && count <= max;
}

// Returns null when the positionals and one-of flag groups fit, or { error, expected }.
export function checkArity(node, positionals, flags) {
  const patterns = patternsFor(node);
  if (!patterns.length) return null;
  const matching = patterns.filter((pattern) => fits(pattern, positionals.length));
  if (!matching.length) {
    const most = Math.max(...patterns.map((pattern) => (pattern.args.some((arg) => arg.variadic) ? Infinity : pattern.args.length)));
    const expected = patterns.map((pattern) => describe(pattern.args)).filter(Boolean);
    if (positionals.length > most) {
      const extra = positionals.slice(most);
      const takes = most === 0 ? "takes no arguments" : `takes at most ${most}: ${expected.join(" or ")}`;
      return {
        error: `unexpected argument${extra.length > 1 ? "s" : ""} ${extra.map((word) => `"${word}"`).join(" ")} for \`${node.path}\` (${takes})`,
        hint: most >= 1 ? "quote text that contains spaces, e.g. \"two words\"" : undefined,
      };
    }
    const pattern = patterns.find((candidate) => candidate.args.filter((arg) => arg.required).length > positionals.length) || patterns[0];
    const missing = pattern.args.filter((arg) => arg.required).slice(positionals.length).map((arg) => `<${arg.name}>`);
    return { error: `missing argument ${missing.join(" ")} for \`${node.path}\`` };
  }
  for (const group of matching[0].oneOf) {
    const present = group.filter((flag) => flags.has(flag));
    if (present.length !== 1) {
      return {
        error: present.length
          ? `${present.join(" and ")} can't be combined for \`${node.path}\`; pass exactly one of ${group.join(", ")}`
          : `\`${node.path}\` needs one of ${group.join(", ")}`,
      };
    }
  }
  return null;
}

// Required/optional arguments for --help, e.g. "<thread-id> (required)".
export function argumentHelp(node) {
  const seen = new Map();
  for (const pattern of patternsFor(node)) {
    for (const arg of pattern.args) {
      const key = arg.name;
      if (!seen.has(key)) seen.set(key, `${arg.required ? `<${arg.name}>` : `[${arg.name}]`}${arg.variadic ? "..." : ""}  ${arg.required ? "required" : "optional"}${arg.variadic ? ", one or more" : ""}`);
    }
  }
  return [...seen.values()];
}

export function oneOfHelp(node) {
  return patternsFor(node).flatMap((pattern) => pattern.oneOf).map((group) => `exactly one of ${group.join(", ")} (required)`);
}
