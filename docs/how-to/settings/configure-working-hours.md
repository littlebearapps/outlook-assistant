---
title: "How to Configure Working Hours"
description: "Set your working hours and time zone so Outlook knows when you're available for scheduling."
tags: [outlook-assistant, settings, how-to]
---

# How to Configure Working Hours

Set your work days, hours, and time zone so Outlook can show your availability correctly for scheduling.

## View Current Working Hours

> "What are my current working hours?"

```
tool: mailbox-settings
params:
  action: "get"
  section: "workingHours"
```

## Set Work Days and Hours

> "Set my working hours to 9am–5:30pm Monday to Friday"

```
tool: mailbox-settings
params:
  action: "set-working-hours"
  startTime: "09:00"
  endTime: "17:30"
  daysOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"]
```

## Set a Non-Standard Schedule

> "I work Tuesday to Saturday, 10am–6pm"

```
tool: mailbox-settings
params:
  action: "set-working-hours"
  startTime: "10:00"
  endTime: "18:00"
  daysOfWeek: ["tuesday", "wednesday", "thursday", "friday", "saturday"]
```

## Change Your Time Zone

> "Update my timezone to Australia/Melbourne"

```
tool: mailbox-settings
params:
  action: "set-working-hours"
  timeZone: "Australia/Melbourne"
```

## Parameter Reference

| Parameter | What it does | Example |
|-----------|-------------|---------|
| `action` | Must be `set-working-hours` | `"set-working-hours"` |
| `startTime` | Work start time (HH:MM) | `"09:00"` |
| `endTime` | Work end time (HH:MM) | `"17:30"` |
| `daysOfWeek` | Array of work days | `["monday", "friday"]` |
| `timeZone` | IANA time zone name | `"Australia/Melbourne"` |

## Tips

- Working hours affect scheduling suggestions and free/busy visibility
- Time uses 24-hour format: `"09:00"` not `"9:00 AM"`
- Day names are lowercase: `"monday"`, not `"Monday"`

## Related

- [Set Out-of-Office](set-out-of-office.md) — configure auto-replies
- [View Upcoming Events](../calendar/view-upcoming-events.md) — check your calendar
- [Tools Reference — mailbox-settings](../../quickrefs/tools-reference.md#settings-1-tool)
