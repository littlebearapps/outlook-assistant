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

Delete removes the event from your calendar without notifying anyone. Use this for personal events or cleaning up old entries.

## Update vs Decline vs Cancel vs Delete

| Action | Who can do it | Notifies others? | Use when |
|--------|--------------|-------------------|----------|
| `update` | Organiser (full edit) / Attendee (limited fields) | Yes — attendees notified of changes | Reschedule, edit, or change attendees on an existing event |
| `decline` | Any attendee | Yes — sends decline to organiser (unless `sendResponse: false`) | You can't attend someone else's meeting |
| `cancel` | Organiser only | Yes — notifies all attendees | You're cancelling a meeting you created |
| `delete` | Anyone | No | Removing a personal event or cleaning up |

## Parameter Reference

| Parameter | What it does | Required |
|-----------|-------------|----------|
| `action` | `update`, `decline`, `cancel`, or `delete` | Yes |
| `eventId` | The event ID (from `list-events`) | Yes |
| `comment` | Message sent with decline/cancel | No (decline/cancel only) |
| `sendResponse` | `false` declines without notifying the organiser (default `true`) | No (decline only) |
| `subject`, `start`, `end`, `attendees`, `body`, `location`, `isOnlineMeeting`, `sensitivity`, `showAs`, `importance`, `categories`, `reminderMinutesBeforeStart` | Event fields to change | No (update only — pass only what changes) |
| `dryRun` | Preview update without applying | No (update only) |

> **Note**: `manage-event` is marked as destructive at the tool level (because `decline`, `cancel`, and `delete` are destructive). Your AI assistant will ask for confirmation before any action — including `update`. Use `dryRun: true` on `update` to preview the change first.

## Tips

- Use `list-events` first to find the event ID
- Always include a `comment` when declining or cancelling — it's courteous and helps the organiser
- Delete is silent — use it for personal events only
- On `update`, the `attendees` field is a full replacement — pass everyone who should be on the event (not just the additions). Passing `attendees: []` clears the list.

## Related

- [View and Search Calendar Events](view-upcoming-events.md) — find the event ID to act on, including past events by date or subject
- [Create Calendar Events](create-calendar-events.md) — schedule a replacement meeting
- [Tools Reference — manage-event](../../quickrefs/tools-reference.md#calendar-3-tools)
