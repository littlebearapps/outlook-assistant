---
title: "How to Manage Event Responses"
description: "Update, decline, cancel, or delete calendar events with the manage-event tool."
tags: [outlook-assistant, calendar, how-to]
---

# How to Manage Event Responses

Update existing events, decline invitations, cancel meetings you organised, or delete events from your calendar — all via the `manage-event` tool.

## Update an Event

> "Move the 2pm meeting to 3pm and add Sarah"

```
tool: manage-event
params:
  action: "update"
  eventId: "AAMkAGR..."
  start: "2026-05-27T15:00:00"
  end: "2026-05-27T16:00:00"
  attendees: ["alex@example.com", "sarah@example.com"]
```

Update changes only the fields you pass; everything else stays as it was. Available fields: `subject`, `start`, `end`, `attendees` (full replacement list), `body`, `location`, `isOnlineMeeting`, `sensitivity`, `showAs`, `importance`, `categories`, `reminderMinutesBeforeStart`. Use `dryRun: true` to preview without applying.

When you change `attendees`, everyone already on the event keeps their attendee type: an optional attendee stays optional and a booked room stays a resource. Anyone new is added as a required attendee. To set or change a type, pass an object instead of an address — an explicit type always wins:

```
tool: manage-event
params:
  action: "update"
  eventId: "AAMkAGR..."
  attendees:
    - "alex@example.com"
    - { email: "sarah@example.com", type: "optional" }
    - { email: "boardroom@example.com", type: "resource" }
```

If any attendee is given without a type, the event's current attendee list is read first, so `dryRun: true` also signs in and shows the types that would be sent.

Updates preserve attendee RSVP state — unlike delete-and-recreate, attendees keep their accepted/tentative status on the rescheduled event. Attendees are notified of the change.

## Decline an Event

> "Decline the 2pm meeting — I have a conflict"

```
tool: manage-event
params:
  action: "decline"
  eventId: "AAMkAGR..."
  comment: "Sorry, I have a conflicting meeting at that time."
```

A decline response is sent to the organiser with your comment. Leave out `comment` and the response goes without a message — nothing is added on your behalf.

To decline without telling the organiser (for example, an invitation from a mailing list), pass `sendResponse: false`:

```
tool: manage-event
params:
  action: "decline"
  eventId: "AAMkAGR..."
  sendResponse: false
```

## Cancel an Event You Organised

> "Cancel tomorrow's team standup"

```
tool: manage-event
params:
  action: "cancel"
  eventId: "AAMkAGR..."
  comment: "Rescheduling to later this week — new invite to follow."
```

All attendees are notified that the event has been cancelled. Without a `comment`, the cancellation goes without a message.

## Delete an Event

> "Remove that old event from my calendar"

```
tool: manage-event
params:
  action: "delete"
  eventId: "AAMkAGR..."
```

Delete removes the event from your calendar. It isn't always silent: if you organised the meeting and it has attendees, Microsoft emails them a cancellation (with no message from you). To control what they receive, use `cancel` with a `comment` instead.

Microsoft Graph doesn't document a guaranteed recovery path for a deleted event, so don't count on getting it back.

## Preview Before You Decline, Cancel or Delete

Add `dryRun: true` to any action to see what it would do without changing or sending anything:

```
tool: manage-event
params:
  action: "cancel"
  eventId: "AAMkAGR..."
  comment: "Rescheduling to later this week."
  dryRun: true
```

The preview reads the event (nothing is written) and starts with `DRY RUN — nothing was changed.` It says exactly who would be emailed:

- **cancel**: "Cancels 'Team sync' on 3 Apr 2026, 9:00 am GMT+11:00 and emails a cancellation to 6 attendees (2 external)", followed by your message and the attendee list
- **decline**: the organiser who would get your response (and whether they're external), or that nobody is told when `sendResponse: false`
- **delete**: whether attendees get a cancellation (only for a meeting you organised that has attendees and isn't already cancelled), or that nobody is emailed
- **update**: the PATCH body that would be sent

"External" means an address whose domain differs from your own signed-in address. The preview also warns when Graph would refuse the action, for example cancelling a meeting you didn't organise.

## Update vs Decline vs Cancel vs Delete

| Action | Who can do it | Notifies others? | Use when |
|--------|--------------|-------------------|----------|
| `update` | Organiser (full edit) / Attendee (limited fields) | Yes — attendees notified of changes | Reschedule, edit, or change attendees on an existing event |
| `decline` | Any attendee | Yes — sends decline to organiser (unless `sendResponse: false`) | You can't attend someone else's meeting |
| `cancel` | Organiser only | Yes — notifies all attendees | You're cancelling a meeting you created |
| `delete` | Anyone | Only if you organised it and it has attendees — they get a cancellation with no message | Removing a personal event or cleaning up; prefer `cancel` for meetings you organised |

## Parameter Reference

| Parameter | What it does | Required |
|-----------|-------------|----------|
| `action` | `update`, `decline`, `cancel`, or `delete` | Yes |
| `eventId` | The event ID (from `list-events`) | Yes |
| `comment` | Message sent with decline/cancel | No (decline/cancel only) |
| `sendResponse` | `false` declines without notifying the organiser (default `true`) | No (decline only) |
| `subject`, `start`, `end`, `attendees`, `body`, `location`, `isOnlineMeeting`, `sensitivity`, `showAs`, `importance`, `categories`, `reminderMinutesBeforeStart` | Event fields to change | No (update only — pass only what changes) |
| `dryRun` | Preview any action without changing or sending anything: who would be emailed (decline/cancel/delete) or the PATCH body (update) | No |

> **Note**: `manage-event` is marked as destructive at the tool level (because `decline`, `cancel`, and `delete` are destructive, and changes can notify attendees). Clients that honour MCP annotations ask for confirmation before any action — including `update`. Use `dryRun: true` to preview any action first.

## Tips

- Use `list-events` first to find the event ID
- Always include a `comment` when declining or cancelling — it's courteous and helps the organiser
- Delete isn't silent for meetings you organised with attendees — they're sent a cancellation. Use `cancel` with a `comment` when you want to say why
- On `update`, the `attendees` field is a full replacement — pass everyone who should be on the event (not just the additions). Passing `attendees: []` clears the list. Existing attendees keep their type (required, optional or resource) unless you pass `{email, type}` to change it.

## Related

- [View and Search Calendar Events](view-upcoming-events.md) — find the event ID to act on, including past events by date or subject
- [Create Calendar Events](create-calendar-events.md) — schedule a replacement meeting
- [Tools Reference — manage-event](../../quickrefs/tools-reference.md#calendar-3-tools)
