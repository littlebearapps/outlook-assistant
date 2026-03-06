---
title: "How to Read Email Threads"
description: "Read individual emails and full conversation threads, with options for body content, previews, and forensic headers."
tags: [outlook-assistant, email, how-to]
---

# How to Read Email Threads

Read the content of individual emails or view entire conversation threads grouped together.

## Read a Specific Email

Once you have an email ID (from a search or listing), read its full content:

> "Read that email from Sarah"

```
tool: read-email
params:
  id: "AAMkAGR..."
```

The response includes the subject, sender, recipients, date, and body content.

## Control How Much Detail You See

| Level | What you get |
|-------|-------------|
| `minimal` | Subject, sender, date — no body |
| `standard` | Subject, sender, date, body content (default) |
| `full` | Everything — full body, all recipients, internet headers |

```
tool: read-email
params:
  id: "AAMkAGR..."
  outputVerbosity: "full"
```

## Browse Conversation Threads

To see your inbox grouped by conversation instead of individual messages:

> "Show me my recent email threads"

```
tool: search-emails
params:
  groupByConversation: true
```

This returns one entry per conversation thread, showing the most recent message in each.

## Read an Entire Thread

Once you have a conversation ID, get all messages in the thread:

> "Show me the full thread for that conversation"

```
tool: search-emails
params:
  conversationId: "AAQkAGR..."
```

Messages are returned in chronological order so you can follow the discussion.

## Include Headers with Email Content

To see basic email headers alongside the body:

```
tool: read-email
params:
  id: "AAMkAGR..."
  includeHeaders: true
```

For forensic header analysis (DKIM, SPF, delivery chain), see [Investigate Email Headers](../advanced/investigate-email-headers.md).

## Tips

- Search first with `search-emails`, then read with `read-email` using the returned ID
- Use `groupByConversation: true` to get a bird's-eye view of your inbox threads
- Use `outputVerbosity: "minimal"` when you're scanning multiple emails and only need subject lines

## Related

- [Find Emails](find-emails.md) — search to find the email you want to read
- [Investigate Email Headers](../advanced/investigate-email-headers.md) — forensic header analysis
- [Export Emails](export-emails.md) — save emails to files
- [Tools Reference — read-email](../../quickrefs/tools-reference.md#email-6-tools)
