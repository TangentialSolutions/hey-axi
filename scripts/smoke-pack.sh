#!/usr/bin/env bash
# Packaging smoke test: npm pack, install the tarball into a clean temp project,
# then run the installed hey-axi --version and --help. Needs no HEY binary or account.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
expected=$(node -p "require('$root/package.json').version")
tarball=$(cd "$root" && npm pack --silent --pack-destination "$work" | tail -n1)
echo "packed: $tarball"
tar -tzf "$work/$tarball" | sort
cd "$work" && npm init -y >/dev/null
npm install --no-audit --no-fund "./$tarball" >/dev/null
bin="$work/node_modules/.bin/hey-axi"
unset HEY_BIN
export PATH="/usr/bin:/bin:$(dirname "$(command -v node)")"   # keep any real `hey` off PATH
version=$("$bin" --version)
echo "hey-axi --version: $version"
[ "$version" = "$expected" ] || { echo "version mismatch: expected $expected, got '$version'" >&2; exit 1; }
help=$("$bin" --help)
[ -n "$help" ] || { echo "hey-axi --help printed nothing" >&2; exit 1; }
echo "hey-axi --help: exit 0, $(printf '%s\n' "$help" | wc -l) lines"
echo "smoke:pack OK"
