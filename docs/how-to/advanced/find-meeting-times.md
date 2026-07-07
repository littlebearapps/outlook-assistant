---
title: "How to Find Meeting Times"
description: "Use Microsoft 365 availability to suggest meeting slots across attendees."
tags: [outlook-assistant, calendar, scheduling, microsoft-365]
---

# How to Find Meeting Times

Find candidate meeting slots across attendees using Microsoft 365 free/busy data.
This feature is available for work/school Microsoft 365 accounts; Microsoft
Graph does not support this endpoint for personal Outlook.com accounts.

## Find a 30-Minute Slot

> "Find a time to meet Alice this week"

```
tool: find-meeting-times
params:
  attendees: ["alice@company.com"]
  duration: 30
  startDateTime: "2026-07-20T09:00:00"
  endDateTime: "2026-07-24T17:00:00"
```

The tool returns ranked suggestions with start/end time, confidence, reason, and
attendee availability.

## Search Outside Work Hours

```
tool: find-meeting-times
params:
  attendees: ["alice@company.com", "bob@company.com"]
  duration: 45
  meetingHours: false
  maxCandidates: 10
```

## Parameter Reference

| Parameter | What it does | Required |
|-----------|-------------|----------|
| `attendees` | Required attendee email addresses | Yes |
| `duration` | Meeting length in minutes | No |
| `meetingDuration` | ISO8601 duration such as `PT30M` | No |
| `startDateTime` | Search-window start | No |
| `endDateTime` | Search-window end | No |
| `meetingHours` | Restrict to work hours unless `false` | No |
| `maxCandidates` | Maximum suggestions to return | No |
| `isOrganizerOptional` | Whether organiser can be unavailable | No |

## Permissions

Work/school tenants need the delegated Microsoft Graph permission
`Calendars.Read.Shared` or `Calendars.ReadWrite.Shared`. If you add this after
initial setup, re-authenticate so the token includes the new scope.

## Related

- [Create Calendar Events](../calendar/create-calendar-events.md) — schedule the chosen slot
- [View Upcoming Events](../calendar/view-upcoming-events.md) — inspect your calendar
- [Tools Reference — find-meeting-times](../../quickrefs/tools-reference.md#advanced-3-tools)
