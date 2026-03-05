---
title: "How to Create Calendar Events"
description: "Schedule meetings and events through your AI assistant, including adding attendees and event descriptions."
tags: [outlook-mcp, calendar, how-to]
---

# How to Create Calendar Events

Schedule meetings, appointments, and events directly from your AI assistant with attendees, descriptions, and locations.

## Create a Simple Event

> "Add a meeting called Standup tomorrow at 9am for 30 minutes"

```
tool: create-event
params:
  subject: "Standup"
  start: "2026-03-02T09:00:00"
  end: "2026-03-02T09:30:00"
```

Times use ISO 8601 format. The server uses your configured timezone (default: Australia/Melbourne).

## Add Attendees

> "Schedule a team review with Alice and Bob for next Monday at 2pm"

```
tool: create-event
params:
  subject: "Team Review"
  start: "2026-03-09T14:00:00"
  end: "2026-03-09T15:00:00"
  attendees: ["alice@company.com", "bob@company.com"]
```

Attendees receive a calendar invitation by email.

## Add a Description and Location

> "Book the Level 3 boardroom for an offsite planning session"

```
tool: create-event
params:
  subject: "Offsite Planning"
  start: "2026-03-10T10:00:00"
  end: "2026-03-10T12:00:00"
  body: "Agenda:\n1. Q2 goals review\n2. Resource planning\n3. Team feedback"
  location: "Level 3 Boardroom"
```

## Parameter Reference

| Parameter | What it does | Required |
|-----------|-------------|----------|
| `subject` | Event title | Yes |
| `start` | Start time (ISO 8601) | Yes |
| `end` | End time (ISO 8601) | Yes |
| `attendees` | List of email addresses | No |
| `body` | Event description or agenda | No |
| `location` | Room name or address | No |

## Timezone Handling

Times are interpreted using the server's configured timezone (default: `Australia/Melbourne`). To ensure correct scheduling:

- **Local time** — omit the `Z` suffix: `2026-03-10T10:00:00` → interpreted as your configured timezone
- **UTC time** — include the `Z` suffix: `2026-03-10T10:00:00Z` → always UTC, converted to your timezone

> **Common pitfall**: If your times include the `Z` (Zulu/UTC) suffix but you intended local time, events will be created at the wrong time. For example, `2026-03-10T10:00:00Z` in Melbourne (UTC+11) would create an event at 9pm, not 10am.

## Tips

- Use plain language — your AI assistant will convert your request into the right parameters and times
- The body field supports plain text — add agendas, links, or preparation notes
- Check your calendar first with `list-events` to avoid double-booking
- Omit the `Z` suffix on times unless you specifically mean UTC
- For finding available rooms, see [Find Meeting Rooms](../advanced/find-meeting-rooms.md)

## Related

- [View Upcoming Events](view-upcoming-events.md) — check your calendar before scheduling
- [Manage Event Responses](manage-event-responses.md) — decline or cancel events
- [Find Meeting Rooms](../advanced/find-meeting-rooms.md) — search for rooms by building or capacity
- [Tools Reference — create-event](../../quickrefs/tools-reference.md#calendar-3-tools)
