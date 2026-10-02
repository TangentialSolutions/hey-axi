// Collapse the user's home directory to `~` in paths shown to agents.
import { homedir } from "node:os";

export function collapse(path, home = homedir()) {
  return path && home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}
