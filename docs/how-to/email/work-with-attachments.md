---
title: "How to Work with Attachments"
description: "List, view, and download email attachments to your local machine."
tags: [outlook-assistant, email, how-to]
---

# How to Work with Attachments

List the attachments on an email, preview their content, or download them to disk.

## List Attachments

> "What attachments does that email have?"

```
tool: attachments
params:
  messageId: "AAMkAGR..."
  action: "list"
```

Returns the name, size, content type, and ID of each attachment.

## View Attachment Content

Preview an attachment's content inline (works best for text, markdown, and simple documents):

```
tool: attachments
params:
  messageId: "AAMkAGR..."
  action: "view"
  attachmentId: "AAMkAGR-att1..."
```

## Download an Attachment

> "Download the PDF from that email to /tmp"

```
tool: attachments
params:
  messageId: "AAMkAGR..."
  action: "download"
  attachmentId: "AAMkAGR-att1..."
  savePath: "/tmp/"
```

The file is saved with its original filename to the specified directory.

## Download All Attachments

List the attachments first, then download each one:

> "Download all attachments from that email to /tmp/attachments/"

The attachments will be listed, then downloaded sequentially.

## Parameter Reference

| Parameter | What it does | Required |
|-----------|-------------|----------|
| `messageId` | The email containing the attachment | Yes |
| `action` | `list`, `view`, or `download` | No (default: `list`) |
| `attachmentId` | Specific attachment ID | Yes for `view`/`download` |
| `savePath` | Directory to save to | No (default: current directory) |

## Tips

- Use `list` first to see attachment names and IDs before downloading
- `view` works well for text-based files (`.txt`, `.csv`, `.md`) — binary files need `download`
- Find emails with attachments using `search-emails` with `hasAttachments: true`

## Related

- [Find Emails](find-emails.md) — search for emails with attachments
- [Export Emails](export-emails.md) — export emails with attachments included
- [Tools Reference — attachments](../../quickrefs/tools-reference.md#email-6-tools)
