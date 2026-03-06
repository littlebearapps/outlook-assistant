---
title: "How to Manage Event Responses"
description: "Decline, cancel, or delete calendar events, with an optional message to organisers or attendees."
tags: [outlook-assistant, calendar, how-to]
---

# How to Manage Event Responses

Decline invitations, cancel meetings you organised, or delete events from your calendar.

## Decline an Event

> "Decline the 2pm meeting — I have a conflict"

```
tool: manage-event
params:
  action: "decline"
  eventId: "AAMkAGR..."
  comment: "Sorry, I have a conflicting meeting at that time."
```

A decline response is sent to the organiser with your comment.

## Cancel an Event You Organised

> "Cancel tomorrow's team standup"

```
tool: manage-event
params:
  action: "cancel"
  eventId: "AAMkAGR..."
  comment: "Rescheduling to later this week — new invite to follow."
```

All attendees are notified that the event has been cancelled.

## Delete an Event

> "Remove that old event from my calendar"

```
tool: manage-event
params:
  action: "delete"
  eventId: "AAMkAGR..."
```

Delete removes the event from your calendar without notifying anyone. Use this for personal events or cleaning up old entries.

## Decline vs Cancel vs Delete

| Action | Who can do it | Notifies others? | Use when |
|--------|--------------|-------------------|----------|
| `decline` | Any attendee | Yes — sends decline to organiser | You can't attend someone else's meeting |
| `cancel` | Organiser only | Yes — notifies all attendees | You're cancelling a meeting you created |
| `delete` | Anyone | No | Removing a personal event or cleaning up |

## Parameter Reference

| Parameter | What it does | Required |
|-----------|-------------|----------|
| `action` | `decline`, `cancel`, or `delete` | Yes |
| `eventId` | The event ID (from `list-events`) | Yes |
| `comment` | Message sent with decline/cancel | No |

> **Note**: This tool is marked as destructive. Your AI assistant will ask for your confirmation before declining, cancelling, or deleting any event.

## Tips

- Use `list-events` first to find the event ID
- Always include a `comment` when declining or cancelling — it's courteous and helps the organiser
- Delete is silent — use it for personal events only

## Related

- [View Upcoming Events](view-upcoming-events.md) — find the event ID to act on
- [Create Calendar Events](create-calendar-events.md) — schedule a replacement meeting
- [Tools Reference — manage-event](../../quickrefs/tools-reference.md#calendar-3-tools)
