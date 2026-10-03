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
  outputDir: "/tmp/attachments/"
```

The directory is created if it doesn't exist. Leave out `outputDir` and the file goes to your system's temp directory. The response tells you the exact path it was saved to.

`outputDir` must be inside your system's temp directory, `~/Downloads`, `~/Documents` or the folder named in `OUTLOOK_EXPORT_DIR`, with no dot-prefixed folder below them; `..` and symlinked folders count as wherever they really lead. Anything else is refused before the attachment is fetched. See [Where exports can be written](export-emails.md#where-exports-can-be-written) to allow another folder.

The filename comes from the sender, so it's reduced to a safe name before saving: path components such as `../` are stripped and the file always lands inside `outputDir`. An existing file is never overwritten and a symlink is never followed; a name that's already taken gets a numbered suffix (`invoice-1.pdf`).

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
| `outputDir` | Directory to save to (`download`), created if missing; must be inside the temp directory, `~/Downloads`, `~/Documents` or `OUTLOOK_EXPORT_DIR`. `savePath` is a deprecated alias | No (default: system temp directory) |
| `sharedMailbox` | Shared mailbox the message belongs to (alias `email`) | Only for shared-mailbox messages |

## Tips

- Use `list` first to see attachment names and IDs before downloading
- `view` works well for text-based files (`.txt`, `.csv`, `.md`) — binary files need `download`
- Find emails with attachments using `search-emails` with `hasAttachments: true`
- For a message from a shared mailbox, pass the same `sharedMailbox` you searched with — see [Access Shared Mailboxes](../advanced/access-shared-mailboxes.md)
- Embedded Outlook items and cloud-link (reference) attachments can't be downloaded as files; the tool tells you when an attachment is one of these

## Related

- [Find Emails](find-emails.md) — search for emails with attachments
- [Export Emails](export-emails.md) — export emails with attachments included
- [Tools Reference — attachments](../../quickrefs/tools-reference.md#email-8-tools)
