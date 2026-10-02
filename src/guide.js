// Static guidance shared by the no-args home view and the generated part of
// skills/hey-axi/SKILL.md (scripts/gen-skill.js), so the two never drift.

export const DESCRIPTION = "HEY email, calendars and todos for agents: compact TOON over Basecamp's HEY CLI; outgoing mail is saved as a draft unless --allow-send";

// How many Imbox threads the home view (and the session hook) shows.
export const HOME_LIMIT = 10;

export const HOME_HELP = [
  "Run `hey-axi thread read <topic_id>` to read a thread",
  "Run `hey-axi box view imbox --limit 50` for more (also feed, papertrail, aside, later)",
  "Run `hey-axi search \"<query>\"` to search mail",
  "Run `hey-axi screener list` for senders waiting to be screened",
  "Run `hey-axi reply <topic_id> --message \"...\"` to draft a reply (not sent without --allow-send)",
  "Run `hey-axi --help` for all commands; lists take --fields a,b / --fields all, long text --full",
];

export const SETUP_HELP = {
  missing: [
    "Install the HEY CLI: curl -fsSL https://hey.com/install-cli | bash (or brew install --cask basecamp/tap/hey)",
    "If it is installed outside PATH, set HEY_BIN=/path/to/hey",
  ],
  auth: [
    "Ask the user to run `hey auth login` in their own terminal (it opens a browser)",
    "Run `hey-axi auth status` to check afterwards",
  ],
  other: ["Run `hey-axi doctor` to find login and configuration problems"],
};
