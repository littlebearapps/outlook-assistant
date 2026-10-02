---
title: "How to Export Emails"
description: "Save emails and conversation threads to your local machine in Markdown, EML, MBOX, JSON, HTML, or CSV formats."
tags: [outlook-assistant, email, how-to]
---

# How to Export Emails

Save individual emails, batches, or entire conversation threads to disk in various formats for archiving, analysis, or migration.

## Export a Single Email

> "Export that email as markdown"

```
tool: export
params:
  target: "message"
  id: "AAMkAGR..."
  format: "markdown"
  savePath: "/tmp/email-export.md"
```

## Export as EML (For Archiving)

EML is the standard email archive format, importable into any email client:

```
tool: export
params:
  target: "message"
  id: "AAMkAGR..."
  format: "eml"
  savePath: "/tmp/email.eml"
```

## Export a Full Conversation Thread

> "Export the entire thread about the contract review"

```
tool: export
params:
  target: "conversation"
  conversationId: "AAQkAGR..."
  format: "markdown"
  outputDir: "/tmp/contract-thread/"
```

Control message order:

```
tool: export
params:
  target: "conversation"
  conversationId: "AAQkAGR..."
  format: "mbox"
  outputDir: "/tmp/contract-thread/"
  order: "chronological"
```

## Batch Export Multiple Emails

Export a list of specific emails:

```
tool: export
params:
  target: "messages"
  emailIds: ["AAMkAGR1...", "AAMkAGR2...", "AAMkAGR3..."]
  format: "markdown"
  outputDir: "/tmp/batch-export/"
```

Or export emails matching a search query:

```
tool: export
params:
  target: "messages"
  searchQuery:
    from: "finance@company.com"
    receivedAfter: "2026-01-01"
    maxResults: 50
  format: "json"
  outputDir: "/tmp/finance-export/"
```

## Export as CSV (For Spreadsheets)

CSV exports email metadata (subject, from, to, dates) without body content — ideal for importing into Excel or Google Sheets:

```
tool: export
params:
  target: "messages"
  searchQuery:
    from: "finance@company.com"
    receivedAfter: "2026-01-01"
  format: "csv"
  outputDir: "/tmp/finance-audit/"
```

Batch CSV exports produce a single aggregated file with one row per email. CSV values are protected against formula injection (OWASP mitigation).

## Get Raw MIME Content

For developers or forensic analysis:

```
tool: export
params:
  target: "mime"
  id: "AAMkAGR..."
```

## Choose the Right Format

| Format | Best for | File type |
|--------|---------|-----------|
| `markdown` | Reading, sharing, AI processing | `.md` |
| `eml` | Archiving, importing to other clients | `.eml` |
| `mbox` | Bulk archiving (one file, many messages) | `.mbox` |
| `json` | Programmatic processing, data analysis | `.json` |
| `html` | Viewing in a browser with formatting | `.html` |
| `csv` | Spreadsheet import, bulk metadata analysis | `.csv` |
| `mime` | Raw email content, forensics | raw output |

## Parameter Reference

| Parameter | What it does | Used with |
|-----------|-------------|-----------|
| `target` | `message`, `messages`, `conversation`, or `mime` | All |
| `id` | Email ID | `message`, `mime` |
| `format` | Output format (see table above) | `message`, `messages`, `conversation` |
| `savePath` | File path for single export | `message` |
| `outputDir` | Directory for batch/thread export | `messages`, `conversation` |
| `emailIds` | Array of email IDs | `messages` |
| `searchQuery` | Search criteria for batch export | `messages` |
| `conversationId` | Thread ID | `conversation` |
| `order` | `chronological` or `reverse` | `conversation` |
| `includeAttachments` | Include attachments | `message` (default: true) |

## Output Filenames

Batch export names each file `<message-timestamp>_<subject>.<ext>`, e.g.
`2023-06-15T01-26-00_Another_transfer.json`.

The **time** matters: before v3.11.1 the name used the date only, so two messages
from the same day sharing a subject — an ordinary same-day reply chain — resolved
to one path and the second silently overwrote the first, while the summary still
reported `Failed 0`.

Two guarantees now hold:

- **Nothing is overwritten.** If a name is already taken, on disk or by another
  message in the same batch, the exporter appends `_2`, `_3`, ... rather than
  clobbering. A note in the output tells you when that happened.
- **Every requested ID is accounted for.** `_meta.manifest` maps each requested
  message ID to the path actually written, so you can reconcile without listing
  the directory:

  ```json
  { "emailId": "AAMk...", "filePath": "/tmp/export/2023-06-15T01-26-00_Another_transfer.json" }
  ```

Attachment files are named the same way and carry the same guarantee.

## Tips

- Use `markdown` format for AI-readable exports
- Use `csv` format to get email metadata into a spreadsheet for analysis
- Use `mbox` for archiving entire conversations in a single file
- Combine with `search-emails` to find emails first, then export the IDs
- The `searchQuery` option in batch mode saves a step — no need to search first

## Related

- [Find Emails](find-emails.md) — search for emails to export
- [Read Email Threads](read-email-threads.md) — read before exporting
- [Work with Attachments](work-with-attachments.md) — download attachments separately
- [Tools Reference — export](../../quickrefs/tools-reference.md#email-6-tools)
