---
title: "How to View Upcoming Calendar Events"
description: "List your scheduled events so Claude can help with scheduling, reminders, and meeting preparation."
tags: [outlook-mcp, calendar, how-to]
---

# How to View Upcoming Calendar Events

Check what's coming up on your calendar so Claude can help with scheduling, preparation, or summarising your day.

## List Your Next Events

> "What's on my calendar this week?"

```
tool: list-events
```

With no parameters, this returns your next 10 upcoming events.

## See More Events

> "Show me my next 30 events"

```
tool: list-events
params:
  count: 30
```

Maximum is 50 events per request.

## What's Included in Each Event

Each event shows:

- **Subject** — meeting title
- **Start/End time** — in your configured timezone (default: Australia/Melbourne)
- **Location** — room or virtual meeting link
- **Attendees** — who's invited
- **Status** — accepted, tentative, declined
- **Online meeting URL** — Teams/Zoom link if applicable

![Event list output showing formatted calendar entries](../../assets/screenshots/view-upcoming-events-01.png)

## Tips

- `list-events` is read-only and auto-approved — no confirmation needed
- Events are sorted chronologically (soonest first)
- Ask Claude to summarise your day: "What meetings do I have today?"
- Combine with email search: "Find any emails from people I'm meeting today"

## Related

- [Create Calendar Events](create-calendar-events.md) — schedule new meetings
- [Manage Event Responses](manage-event-responses.md) — decline or cancel events
- [Find Meeting Rooms](../advanced/find-meeting-rooms.md) — search for available rooms
- [Tools Reference — list-events](../../quickrefs/tools-reference.md#calendar-3-tools)
