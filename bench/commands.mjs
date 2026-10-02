// The benchmark's representative commands. Every one is READ-ONLY; capture.mjs refuses
// to run anything whose command path isn't in READ_ONLY_PATHS.

export const READ_ONLY_PATHS = new Set(["box list", "box view", "thread read", "label list", "screener list", "event week", "todo list", "search"]);

export function benchCommands({ threadId = "50000", searchQuery = "invoice" } = {}) {
  return [
    { name: "box list", path: "box list", argv: ["box", "list"] },
    { name: "box view imbox", path: "box view", argv: ["box", "view", "imbox"] },
    { name: "thread read (long thread)", path: "thread read", argv: ["thread", "read", String(threadId)] },
    { name: "label list", path: "label list", argv: ["label", "list"] },
    { name: "screener list", path: "screener list", argv: ["screener", "list"] },
    { name: "event week", path: "event week", argv: ["event", "week"] },
    { name: "todo list", path: "todo list", argv: ["todo", "list"] },
    { name: "search (paged)", path: "search", argv: ["search", searchQuery] },
    { name: "error (thread not found)", path: "thread read", argv: ["thread", "read", "999999"] },
  ];
}
