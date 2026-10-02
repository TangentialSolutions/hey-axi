// The absolute path of a file, with the user's home directory collapsed to `~`, for
// paths shown to agents.
import { homedir } from "node:os";
import { resolve, sep } from "node:path";

export function collapse(path, home = homedir()) {
  if (!path) return path;
  const absolute = resolve(path);
  if (!home) return absolute;
  if (absolute === home) return "~";
  return absolute.startsWith(home.endsWith(sep) ? home : home + sep) ? `~${absolute.slice(home.replace(/[\\/]$/, "").length)}` : absolute;
}
