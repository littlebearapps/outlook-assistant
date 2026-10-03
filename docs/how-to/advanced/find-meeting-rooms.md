---
title: "How to Find Meeting Rooms"
description: "Search your organisation's meeting room directory by building, floor, capacity, or name."
tags: [outlook-assistant, advanced, how-to]
---

# How to Find Meeting Rooms

Search your organisation's meeting room directory to find available rooms by building, floor, or capacity.

## List All Rooms

> "Show me available meeting rooms"

```
tool: find-meeting-rooms
```

## Search by Building

> "Find rooms in the Melbourne HQ building"

```
tool: find-meeting-rooms
params:
  building: "Melbourne HQ"
```

## Filter by Minimum Capacity

> "Find a room that seats at least 10 people"

```
tool: find-meeting-rooms
params:
  capacity: 10
```

## Filter by Floor

```
tool: find-meeting-rooms
params:
  building: "Melbourne HQ"
  floor: 3
```

## Search by Room Name

```
tool: find-meeting-rooms
params:
  query: "Boardroom"
```

## See Full Room Details

```
tool: find-meeting-rooms
params:
  building: "Melbourne HQ"
  outputVerbosity: "full"
```

With `outputVerbosity: "full"`, the response includes equipment and accessibility information when your organisation has configured it:

- **Audio**: conference phone or speaker system name
- **Video**: camera or video conferencing device
- **Display**: screen or projector details
- **Wheelchair Accessible**: yes/no

This is particularly useful when booking rooms for presentations (need a display), remote meetings (need video/audio), or when attendees have accessibility requirements.

## Required Permissions

The tool first queries `/places`, which needs the `Place.Read.All` Microsoft Graph permission (admin consent required). Outlook Assistant doesn't ask for it at sign-in, so to use `/places`, add it to your app registration in Azure Portal, have an administrator grant consent, then re-authenticate with `auth action=authenticate force=true`. Without it, the tool falls back to `me/findRooms`, which doesn't need `Place.Read.All` but is currently unreliable on Graph v1.0 (tracked in [#240](https://github.com/littlebearapps/outlook-assistant/issues/240)). Your Exchange administrator must also have configured room resources in your organisation's directory.

## Parameter Reference

| Parameter | What it does | Example |
|-----------|-------------|---------|
| `query` | Search by room name or email | `"Boardroom"` |
| `building` | Filter by building name | `"Melbourne HQ"` |
| `floor` | Filter by floor number | `3` |
| `capacity` | Minimum seats required | `10` |
| `outputVerbosity` | `minimal`, `standard`, or `full` | `"full"` |

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| No results returned | Missing permission or no rooms configured | Add `Place.Read.All` permission; check with Exchange admin |
| "Forbidden" error | Permission not granted | Grant `Place.Read.All` in Azure Portal |

## Tips

- This tool is read-only, so clients that support MCP annotations can auto-approve it
- Combine with `create-event` to book a room: find it, then add the room's email as an attendee with `type: "resource"`
- Not all organisations have room resources configured — check with your IT admin

## Related

- [Create Calendar Events](../calendar/create-calendar-events.md) — schedule a meeting in the room
- [View Upcoming Events](../calendar/view-upcoming-events.md) — check your calendar
- [Tools Reference — find-meeting-rooms](../../quickrefs/tools-reference.md#advanced-2-tools)
