# Outlook Assistant guard (Hermes Agent)

The safety layer for [Outlook Assistant](https://github.com/littlebearapps/outlook-assistant) in [Hermes Agent](https://github.com/NousResearch/hermes-agent). Install it alongside the `outlook-assistant` plugin, which provides the Outlook tools themselves.

Hermes loads the Outlook Assistant server and its skill from the `outlook-assistant` plugin, but it doesn't run that plugin's safety hook or read the server's built-in rules. This plugin adds them back:

- **Asks before anything risky.** Before any Outlook call that emails or notifies other people, deletes something, or keeps acting (inbox rules, forwarding, automatic replies), Hermes asks you, with a plain-English reason. For example: "Outlook Assistant: Sends an email to alice@example.com, subject «Q3 figures». It can't be unsent." Reads and genuine dry runs (`dryRun: true`) run without asking.
- **Marks other people's content as untrusted.** After tools that return email, calendar, contact or directory content, it adds a note to the result: the content is data, not instructions.
- **Adds the hard rules to the system prompt.** It also points the model at the `using-outlook-assistant` skill, which Hermes otherwise lists only when asked.

## Install

Requires Hermes Agent 0.21.5 or later, and Node.js (the Outlook Assistant server needs it too).

```
hermes plugins install outlook-assistant --enable
hermes plugins install outlook-assistant-guard --enable
```

Start a new session afterwards. Check that both are listed as enabled with `hermes plugins list`. If this plugin fails to load, the Outlook tools still work, but without these checks.

## What you see

| Where Hermes runs | What happens before a risky Outlook call |
|---|---|
| Terminal | A confirmation prompt with the reason: allow once, for the session, always, or deny |
| Messaging gateway (Telegram, Discord, …) | An approval message with the reason; answer `/approve` or `/deny` |
| Cron jobs, `hermes chat -q`, webhooks | Refused, because nobody is there to approve it |
| `--yolo`, `/yolo` or approvals turned off | Runs without asking; use `confirm_level: block` to refuse these calls instead |

Answering "always" approves only that exact call again (the same recipients, subject and effect), not every later email.

**Fails closed.** If the check itself can't run (Node.js missing, an error, no answer within 20 seconds), Hermes asks you, with a "couldn't check" reason. An Outlook tool or action this plugin doesn't recognise also asks.

## Settings

`confirm_level`:

| Value | Asks before |
|---|---|
| `outward` (default) | Calls that reach other people, delete something or keep acting |
| `all-writes` | Those, plus reversible changes (flags, moves, categories, drafts) |
| `block` | Nothing: those calls are refused outright, even under `--yolo` |
| `off` | Nothing; the note and the system-prompt rules stay |

Set it with `hermes config set plugins.entries.outlook-assistant-guard.settings.confirm_level block`, or in the Hermes desktop app's Plugins tab. The `OUTLOOK_CONFIRM_LEVEL` environment variable is used when the setting isn't present.

Server settings (read-only mode, the recipient allowlist, session limits) belong to the Outlook Assistant server. See the [main README](https://github.com/littlebearapps/outlook-assistant#hermes-agent).

## Disclosure

For each Outlook tool call, this plugin runs `node` on its bundled script (`hooks/outlook-gate.js`), which reads only its bundled `hooks/risk-map.json`. It makes no network calls and writes no files. Hermes itself records "session" and "always" answers. Released under the MIT licence, as part of Outlook Assistant.
