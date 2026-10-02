# Scheduled HEY CLI Processing

## Useful commands

- `hey box view imbox --json` — Fetch current Imbox threads, including IDs and metadata.
- `hey box view imbox --ids-only` — Return only Imbox thread IDs for scripting.
- `hey watch --box imbox --events new --run-sync '<command>'` — Continuously watch for new Imbox mail and run a command once per new thread.
- `hey search --in imbox --from sender@example.com --json` — Find matching Imbox threads by sender.
- `hey search --in imbox --subject "invoice" --json` — Find matching Imbox threads by subject.
- `hey search --in imbox "keyword" --ids-only` — Find matching Imbox thread IDs by text.
- `hey label list --json` — List labels and obtain the label IDs needed for labeling.
- `hey label add <thread_id> --to <label_id>` — Apply a label to a thread.
- `hey label add <thread_id_1> <thread_id_2> --to <label_id>` — Apply one label to multiple threads.
- `hey seen <thread_id>` — Mark a thread as seen/read.
- `hey seen <thread_id_1> <thread_id_2>` — Mark multiple threads as seen/read.
- `hey thread read <thread_id> --json` — Fetch the full thread when rules need to inspect its messages or body.

## Leaving messages alone

Leave a thread untouched by excluding its ID from the `hey label add` and `hey seen` commands.

## Scheduling

For periodic execution, an external scheduler such as macOS `launchd` or cron can invoke a script containing these commands.

Alternatively, `hey watch` can handle continuous event-driven checking:

```bash
hey watch --box imbox --events new --run-sync './triage-hey-message.sh'
```

The processing script can inspect each new thread, apply labels with `hey label add`, mark selected threads as read with `hey seen`, and do nothing for messages that should remain untouched.
