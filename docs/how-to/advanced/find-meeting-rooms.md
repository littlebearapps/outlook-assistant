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

Meeting rooms are a Microsoft 365 (work or school) feature. On a personal Microsoft account (Outlook.com, Hotmail, Live), Graph doesn't support room lookup, so the tool returns an error saying so.

The tool first reads Graph `places`, every page up to 1,000 rooms. That needs the `Place.Read.All` permission (admin consent required), which Outlook Assistant doesn't request at sign-in yet ([#130](https://github.com/littlebearapps/outlook-assistant/issues/130)). If an administrator has granted it to your app registration, `auth action=about` shows whether it is in your token. When Graph refuses `places`, the tool falls back to the beta `findRooms` call, which needs only `User.Read` but returns names and addresses only, for at most the first 100 rooms; the result says when it did this, and `building`, `floor` and `capacity` can't be applied to it. Your Exchange administrator must also have configured room resources in your organisation's directory.

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
| No results returned | No rooms configured, or filters too narrow | Check with your Exchange admin; drop `building`/`floor`/`capacity` |
| "Listed with the beta `findRooms` call" note | `places` was refused for want of `Place.Read.All` | Expected until [#130](https://github.com/littlebearapps/outlook-assistant/issues/130); the list has names and addresses only |
| "Couldn't list meeting rooms" error | Both `places` and the beta `findRooms` failed | Read the Graph error in the message; add the room by its email address if you know it |
| "Meeting rooms are a Microsoft 365 … feature" error | Personal Microsoft account | Sign in with a work or school account |

## Tips

- This tool is read-only, so clients that support MCP annotations can auto-approve it
- Combine with `create-event` to book a room: find it, then add the room's email as an attendee with `type: "resource"`
- Not all organisations have room resources configured — check with your IT admin

## Related

- [Create Calendar Events](../calendar/create-calendar-events.md) — schedule a meeting in the room
- [View Upcoming Events](../calendar/view-upcoming-events.md) — check your calendar
- [Tools Reference — find-meeting-rooms](../../quickrefs/tools-reference.md#advanced-2-tools)
