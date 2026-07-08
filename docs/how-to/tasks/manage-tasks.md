---
title: "Manage Microsoft To Do Tasks"
description: "List task lists, create tasks, update tasks, complete tasks, and delete tasks."
tags: [outlook-assistant, tasks, microsoft-to-do, how-to]
---

# Manage Microsoft To Do Tasks

Use `manage-tasks` to work with Microsoft To Do through Microsoft Graph.

## List Task Lists

```
tool: manage-tasks
params:
  action: "list-lists"
```

Use the returned `listId` for task actions.

## List Tasks

```
tool: manage-tasks
params:
  action: "list"
  listId: "task-list-id"
  count: 25
```

## Create a Task

Preview first:

```
tool: manage-tasks
params:
  action: "create"
  listId: "task-list-id"
  title: "Review PR #88"
  body: "Check release notes and tests"
  dueDateTime: "2026-07-10T09:00:00"
  importance: "high"
  dryRun: true
```

Then create it by removing `dryRun` or setting it to `false`.

## Update or Complete a Task

```
tool: manage-tasks
params:
  action: "update"
  listId: "task-list-id"
  taskId: "task-id"
  title: "Review PR #88 and release notes"
```

```
tool: manage-tasks
params:
  action: "complete"
  listId: "task-list-id"
  taskId: "task-id"
```

## Delete a Task

```
tool: manage-tasks
params:
  action: "delete"
  listId: "task-list-id"
  taskId: "task-id"
```

Task deletion is destructive, so MCP clients should prompt before approving it.

## Permissions

Your Azure app registration needs delegated Microsoft Graph `Tasks.Read` and
`Tasks.ReadWrite` permissions. If you add these after you have already
authenticated, delete the token file and authenticate again so Microsoft issues
a token with the new scopes.
