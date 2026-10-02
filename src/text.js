// Small text helpers shared by output, help and errors.

// Point command suggestions at hey-axi instead of the wrapped CLI: "hey thread read 1"
// becomes "hey-axi thread read 1". Only `hey` followed by a lowercase command word is
// rewritten, so prose ("Hey there", "hey.com") is left alone.
export function heyToAxi(text) {
  if (typeof text !== "string") return text;
  return text.replace(/(^|[\s`'"(])hey (?=[a-z][a-z-]*)/g, "$1hey-axi ");
}

// Quote an argv word for display in a suggested command line.
export function shellWord(word) {
  return /^[\w@%+=:,./<>-]+$/.test(word) ? word : `'${String(word).replace(/'/g, `'\\''`)}'`;
}
