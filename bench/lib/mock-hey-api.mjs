// A local, read-only stand-in for app.hey.com that serves the SYNTHETIC fixtures in
// bench/api-fixtures. Only GET is answered; anything else gets 405, so nothing the CLI
// does against it can mutate anything (there's nothing real behind it anyway).

import http from "node:http";
import { readFileSync } from "node:fs";

const fixtureDir = new URL("../api-fixtures/", import.meta.url);

export function loadFixtures() {
  const index = JSON.parse(readFileSync(new URL("index.json", fixtureDir), "utf8"));
  return Object.entries(index.fixtures).map(([operationId, entry]) => ({
    operationId,
    pattern: new RegExp(`^${entry.template.replace(/\.json$/, "").replace(/\{[^}]+\}/g, "[^/]+")}$`),
    body: readFileSync(new URL(entry.file, fixtureDir), "utf8"),
  }));
}

// notFound: request paths (without .json) that should answer 404, for the error case.
export function startMockHeyApi({ notFound = [] } = {}) {
  const fixtures = loadFixtures();
  const requests = [];
  const server = http.createServer((req, res) => {
    const path = req.url.split("?")[0].replace(/\.json$/, "");
    requests.push(`${req.method} ${req.url}`);
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(body);
    };
    if (req.method !== "GET") return send(405, '{"error":"read-only mock"}');
    if (notFound.some((prefix) => path.startsWith(prefix))) return send(404, '{"error":"Not found"}');
    const fixture = fixtures.find((candidate) => candidate.pattern.test(path));
    return fixture ? send(200, fixture.body) : send(404, '{"error":"Not found"}');
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    resolve({ url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((done) => server.close(done)) });
  }));
}
