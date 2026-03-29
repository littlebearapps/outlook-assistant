---
title: "How to Create and Manage Email Drafts"
description: "Save emails as drafts for review, update them, then send when ready. Reply and forward as drafts too."
tags: [outlook-assistant, email, drafts, how-to]
---

# How to Create and Manage Email Drafts

Save emails as drafts in your Outlook Drafts folder, edit them, and send when ready. Useful for composing important emails that need review before sending, or preparing replies you want to revisit later.

## Create a Draft

> "Draft an email to Sarah about the project update — save it, don't send"

```
tool: draft
params:
  action: "create"
  to: "sarah@company.com"
  subject: "Project Alpha Update"
  body: "Hi Sarah,\n\nHere's the latest on Project Alpha..."
```

The draft is saved to your Drafts folder. The response includes the **draft ID** — you'll need this to update, send, or delete it later.

Unlike `send-email`, drafts don't require all fields. You can save a draft with just a subject, just a body, or even empty — fill in the details later.

## Preview Before Saving (Dry Run)

> "Show me what this draft would look like before saving"

```
tool: draft
params:
  action: "create"
  to: "sarah@company.com"
  subject: "Project Alpha Update"
  body: "Hi Sarah..."
  dryRun: true
```

Returns a preview of the draft without saving it to your Drafts folder.

## Update a Draft

> "Update that draft — change the subject and add a CC"

```
tool: draft
params:
  action: "update"
  id: "draft-id-from-create"
  subject: "Project Alpha — Q2 Update"
  cc: "manager@company.com"
  body: "Hi Sarah and team,\n\nUpdated content..."
```

You can update any combination of subject, body, recipients (to/cc/bcc), and importance. Only the fields you include are changed.

## Send a Draft

> "That draft looks good — send it"

```
tool: draft
params:
  action: "send"
  id: "draft-id-from-create"
```

The draft is sent and moved to Sent Items. **Note**: The draft ID becomes invalid after sending — the message gets a new ID in Sent Items.

The send action shares rate limits with `send-email`, so the same `OUTLOOK_MAX_EMAILS_PER_SESSION` limit applies.

## Delete a Draft

> "Delete that draft, I don't need it"

```
tool: draft
params:
  action: "delete"
  id: "draft-id"
```

## Reply as Draft

> "Draft a reply to that email from Sarah — I'll review it before sending"

```
tool: draft
params:
  action: "reply"
  id: "original-message-id"
  comment: "Thanks for the update, Sarah. I'll review and get back to you."
```

Creates a reply draft with the correct `RE:` subject, original recipient, and threading headers auto-populated. The draft appears in your Drafts folder for review.

For reply-all:

```
tool: draft
params:
  action: "reply-all"
  id: "original-message-id"
  comment: "Thanks everyone."
```

### Comment vs Body

- `comment` — short text prepended above the quoted original message (most common)
- `body` — full HTML or text body replacing the default reply content (advanced)

These are mutually exclusive — use one or the other, not both.

## Forward as Draft

> "Forward that email to James — save as draft so I can add a note first"

```
tool: draft
params:
  action: "forward"
  id: "original-message-id"
  to: "james@company.com"
  comment: "FYI — relevant to our discussion yesterday."
```

Forward requires a `to` recipient. The original message content and attachments are included automatically.

## Find Your Drafts

Use `search-emails` with the drafts folder to list your saved drafts:

```
tool: search-emails
params:
  folder: "drafts"
  count: 10
```

## Safety Controls

The `draft` tool inherits the same safety controls as `send-email`:

| Control | Applies to | Config |
|---------|-----------|--------|
| Dry-run preview | `create` | `dryRun: true` |
| Mail-tips check | `create` | `checkRecipients: true` |
| Recipient allowlist | `create`, `update`, `forward` | `OUTLOOK_ALLOWED_RECIPIENTS` env |
| Rate limiting | `create`, `update` | `OUTLOOK_MAX_DRAFT_PER_SESSION` env |
| Send rate limiting | `send` | `OUTLOOK_MAX_EMAILS_PER_SESSION` env (shared with `send-email`) |

## Tips

- Use drafts for important emails that need review — safer than `send-email` with `dryRun`
- The draft-then-send workflow gives you a real draft in Outlook that you can also edit in the Outlook app
- Reply/forward drafts preserve threading — the sent message appears in the correct conversation
- No new Azure permissions needed — drafts use the same `Mail.ReadWrite` and `Mail.Send` scopes

## Related

- [Send Email Safely](send-email-safely.md) — direct send with dry-run and safety controls
- [Check Recipients Before Sending](check-recipients-before-sending.md) — pre-send mail tips
- [Find Emails](find-emails.md) — search for emails to reply to
- [Tools Reference — draft](../../quickrefs/tools-reference.md#email-8-tools)
