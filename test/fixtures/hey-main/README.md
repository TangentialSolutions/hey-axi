# Real HEY CLI output (synthetic data)

Captured on 2026-10-05 by running real HEY CLI binaries against a local mock of HEY's API
(invented data; no account, no mailbox), so the tests read exactly what HEY prints:

| File | Binary | Command |
|---|---|---|
| `compose-sent.json` | basecamp/hey-cli main at 8bf9310 (built from source) | `hey compose --to maria@example.com --subject "Board update" -m Numbers --json` (stdout) |
| `compose-delayed.json` | same | same, with the API answering `delayed: true` (Undo Send holding it) |
| `compose-refused.stderr.json` | same | same, with the API refusing the send (302 to the draft's edit page); exit 7, stderr |
| `compose-sent-v1.7.0.json` | HEY CLI v1.7.0 release | the "sent" case (v1.7.0 prints the same for a refused send) |
| `contact-deliver.json` | main at 8bf9310 | `hey contact deliver 12345 --to feed --json` (stdout) |
