// Static guidance shared by the no-args home view and the generated part of
// skills/hey-axi/SKILL.md (scripts/gen-skill.js), so the two never drift.

import { withSelectors } from "./shape.js";

export const DESCRIPTION = "HEY email, calendars and todos for agents: compact TOON over Basecamp's HEY CLI; outgoing mail is saved as a draft unless --allow-send";

// How many threads the home view (and the session hook) shows by default.
export const HOME_LIMIT = 10;

export const HOME_HELP = [
  "Run `hey-axi thread read <topic_id>` to read a thread",
  "Run `hey-axi box view imbox --limit 50` for more (also feed, papertrail, aside, later)",
  "Run `hey-axi search \"<query>\"` to search mail",
  "Run `hey-axi screener list` for senders waiting to be screened",
  "Run `hey-axi reply <topic_id> --message \"...\"` to draft a reply (not sent without --allow-send)",
  "Run `hey-axi --help` for all commands; lists take --fields a,b / --fields all, long text --full",
];

// The live home view's help: the static lines, pointed at the scope's command, with the
// scope's --account carried into every suggestion, plus "see the rest" / --full /
// review-drafts hints when they apply.
export function homeHelp({ base = "hey-axi box view imbox", carry = [], more = false, total, truncated = false, drafts = false, search = false, unsure = false } = {}) {
  const lines = HOME_HELP.map((line) => {
    if (line.includes("box view imbox --limit 50")) {
      if (!more) return `Run \`${withSelectors("hey-axi box list", carry)}\` for other boxes (feed, papertrail, aside, later)`;
      const count = total !== undefined ? `all ${total}` : "more";
      return search ? `Run \`${base}\` for ${count}` : `Run \`${base} --all\` for ${count} (or --limit <n>)`;
    }
    return line.replace(/`(hey-axi [^`]*)`/, (_, command) => (command === "hey-axi --help" ? `\`${command}\`` : `\`${withSelectors(command, carry)}\``));
  }).filter(Boolean);
  if (truncated) lines.push(`Run \`${base} --full\` to see complete content`);
  // An empty page HEY gave no paging signal for: how to check every page.
  if (unsure && !search) lines.unshift(`Run \`${base} --all\` to check every page`);
  if (drafts) lines.unshift(`Run \`${withSelectors("hey-axi draft list", carry)}\` to review drafts saved last session (not sent)`);
  return lines;
}

export const SETUP_HELP = {
  missing: [
    "Install the HEY CLI: curl -fsSL https://hey.com/install-cli | bash (or brew install --cask basecamp/tap/hey)",
    "If it is installed outside PATH, set HEY_BIN=/path/to/hey",
  ],
  auth: [
    "Ask the user to run `hey-axi auth login --interactive` in their own terminal (it opens a browser), or run `hey-axi auth login --token <token>`",
    "Run `hey-axi auth status` to check afterwards",
  ],
  other: ["Run `hey-axi doctor` to find login and configuration problems"],
};
