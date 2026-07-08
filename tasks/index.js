const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const { DEFAULT_TIMEZONE } = require('../config');
const { checkRateLimit } = require('../utils/safety');
const { TASK_FIELDS } = require('../utils/field-presets');

const TASK_LIST_FIELDS = ['id', 'displayName', 'isOwner', 'isShared'];

function encodeSegment(value) {
  return encodeURIComponent(value);
}

function taskEndpoint(listId, taskId) {
  const base = `me/todo/lists/${encodeSegment(listId)}/tasks`;
  return taskId ? `${base}/${encodeSegment(taskId)}` : base;
}

function formatDateTime(dateTime) {
  if (!dateTime) return null;
  return {
    dateTime: dateTime.replace(/Z$/i, ''),
    timeZone: DEFAULT_TIMEZONE,
  };
}

function buildTaskPayload(args, includeTitle = false) {
  const payload = {};
  if (includeTitle || args.title !== undefined) {
    payload.title = args.title;
  }
  if (args.body !== undefined) {
    payload.body = {
      content: args.body || '',
      contentType: 'text',
    };
  }
  if (args.dueDateTime !== undefined) {
    payload.dueDateTime = args.dueDateTime
      ? formatDateTime(args.dueDateTime)
      : null;
  }
  if (args.importance !== undefined) {
    payload.importance = args.importance;
  }
  return payload;
}

function formatTaskList(list, verbosity = 'standard') {
  if (verbosity === 'minimal') {
    return `- ${list.displayName || '(No name)'} (${list.id})`;
  }
  const lines = [`### ${list.displayName || '(No name)'}`];
  lines.push(`**ID**: ${list.id}`);
  if (list.isOwner !== undefined) lines.push(`**Owner**: ${list.isOwner}`);
  if (list.isShared !== undefined) lines.push(`**Shared**: ${list.isShared}`);
  if (verbosity === 'full' && list.wellknownListName) {
    lines.push(`**Well-known Name**: ${list.wellknownListName}`);
  }
  return lines.join('\n');
}

function formatTask(task, verbosity = 'standard') {
  if (verbosity === 'minimal') {
    return `- ${task.title || '(No title)'} (${task.status || 'unknown'})`;
  }

  const lines = [`### ${task.title || '(No title)'}`];
  lines.push(`**ID**: ${task.id}`);
  if (task.status) lines.push(`**Status**: ${task.status}`);
  if (task.importance) lines.push(`**Importance**: ${task.importance}`);
  if (task.dueDateTime?.dateTime) {
    lines.push(
      `**Due**: ${task.dueDateTime.dateTime} (${task.dueDateTime.timeZone || DEFAULT_TIMEZONE})`
    );
  }
  if (verbosity === 'full') {
    if (task.createdDateTime)
      lines.push(`**Created**: ${task.createdDateTime}`);
    if (task.lastModifiedDateTime) {
      lines.push(`**Modified**: ${task.lastModifiedDateTime}`);
    }
    if (task.body?.content) lines.push(`**Body**: ${task.body.content}`);
  }
  return lines.join('\n');
}

function dryRunResponse(action, payload) {
  return {
    content: [
      {
        type: 'text',
        text: `DRY RUN — Task ${action} not saved.\n\nPayload:\n${JSON.stringify(payload, null, 2)}`,
      },
    ],
    _meta: { dryRun: true, action, payload },
  };
}

function requireParam(args, name, label = name) {
  if (!args[name]) {
    return {
      content: [{ type: 'text', text: `${label} is required.` }],
      isError: true,
    };
  }
  return null;
}

async function handleListLists(args, accessToken) {
  const count = Math.min(args.count || 50, 100);
  const verbosity = args.outputVerbosity || 'standard';
  const response = await callGraphAPI(
    accessToken,
    'GET',
    'me/todo/lists',
    null,
    { $top: count, $select: TASK_LIST_FIELDS.join(',') }
  );
  const lists = response.value || [];
  const output = ['# Task Lists', `**Showing**: ${lists.length}`, ''];
  lists.forEach((list) => {
    output.push(formatTaskList(list, verbosity));
    output.push('');
  });
  return {
    content: [{ type: 'text', text: output.join('\n') }],
    _meta: { action: 'list-lists', count: lists.length },
  };
}

async function handleListTasks(args, accessToken) {
  const missing = requireParam(args, 'listId', 'listId');
  if (missing) return missing;

  const count = Math.min(args.count || 25, 100);
  const verbosity = args.outputVerbosity || 'standard';
  const response = await callGraphAPI(
    accessToken,
    'GET',
    taskEndpoint(args.listId),
    null,
    { $top: count, $select: TASK_FIELDS.full.join(',') }
  );
  const tasks = response.value || [];
  const output = [
    '# Tasks',
    `**List ID**: ${args.listId}`,
    `**Showing**: ${tasks.length}`,
    '',
  ];
  tasks.forEach((task) => {
    output.push(formatTask(task, verbosity));
    output.push('');
  });
  return {
    content: [{ type: 'text', text: output.join('\n') }],
    _meta: { action: 'list', listId: args.listId, count: tasks.length },
  };
}

async function handleCreateTask(args, accessToken) {
  let missing = requireParam(args, 'listId', 'listId');
  if (missing) return missing;
  missing = requireParam(args, 'title', 'title');
  if (missing) return missing;

  const payload = buildTaskPayload(args, true);
  if (args.dryRun) return dryRunResponse('create', payload);

  const rateLimit = checkRateLimit('manage-tasks');
  if (rateLimit) return rateLimit;

  const task = await callGraphAPI(
    accessToken,
    'POST',
    taskEndpoint(args.listId),
    payload
  );
  return {
    content: [
      {
        type: 'text',
        text: `# Task Created\n\n${formatTask(task, 'full')}`,
      },
    ],
    _meta: { action: 'create', listId: args.listId, taskId: task.id },
  };
}

async function handleUpdateTask(args, accessToken) {
  let missing = requireParam(args, 'listId', 'listId');
  if (missing) return missing;
  missing = requireParam(args, 'taskId', 'taskId');
  if (missing) return missing;

  const payload = buildTaskPayload(args);
  if (Object.keys(payload).length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'At least one update field is required: title, body, dueDateTime, or importance.',
        },
      ],
      isError: true,
    };
  }
  if (args.dryRun) return dryRunResponse('update', payload);

  const rateLimit = checkRateLimit('manage-tasks');
  if (rateLimit) return rateLimit;

  const task = await callGraphAPI(
    accessToken,
    'PATCH',
    taskEndpoint(args.listId, args.taskId),
    payload
  );
  return {
    content: [
      {
        type: 'text',
        text: `# Task Updated\n\n${formatTask(task, 'full')}`,
      },
    ],
    _meta: { action: 'update', listId: args.listId, taskId: task.id },
  };
}

async function handleCompleteTask(args, accessToken) {
  let missing = requireParam(args, 'listId', 'listId');
  if (missing) return missing;
  missing = requireParam(args, 'taskId', 'taskId');
  if (missing) return missing;

  const rateLimit = checkRateLimit('manage-tasks');
  if (rateLimit) return rateLimit;

  const task = await callGraphAPI(
    accessToken,
    'PATCH',
    taskEndpoint(args.listId, args.taskId),
    { status: 'completed' }
  );
  return {
    content: [
      {
        type: 'text',
        text: `# Task Completed\n\n${formatTask(task, 'full')}`,
      },
    ],
    _meta: { action: 'complete', listId: args.listId, taskId: task.id },
  };
}

async function handleDeleteTask(args, accessToken) {
  let missing = requireParam(args, 'listId', 'listId');
  if (missing) return missing;
  missing = requireParam(args, 'taskId', 'taskId');
  if (missing) return missing;

  const rateLimit = checkRateLimit('manage-tasks');
  if (rateLimit) return rateLimit;

  await callGraphAPI(
    accessToken,
    'DELETE',
    taskEndpoint(args.listId, args.taskId)
  );
  return {
    content: [
      {
        type: 'text',
        text: `# Task Deleted\n\nTask \`${args.taskId}\` has been deleted.`,
      },
    ],
    _meta: {
      action: 'delete',
      listId: args.listId,
      taskId: args.taskId,
      deleted: true,
    },
  };
}

async function handleManageTasks(args = {}) {
  const action = args.action || 'list-lists';

  if (['create', 'update'].includes(action) && args.dryRun) {
    return action === 'create'
      ? handleCreateTask(args, null)
      : handleUpdateTask(args, null);
  }

  try {
    const accessToken = await ensureAuthenticated();
    switch (action) {
      case 'list-lists':
        return handleListLists(args, accessToken);
      case 'list':
        return handleListTasks(args, accessToken);
      case 'create':
        return handleCreateTask(args, accessToken);
      case 'update':
        return handleUpdateTask(args, accessToken);
      case 'complete':
        return handleCompleteTask(args, accessToken);
      case 'delete':
        return handleDeleteTask(args, accessToken);
      default:
        return {
          content: [
            {
              type: 'text',
              text: `Unknown action '${action}'. Valid actions: list-lists, list, create, update, complete, delete.`,
            },
          ],
          isError: true,
        };
    }
  } catch (error) {
    if (error.message === 'Authentication required') {
      return {
        content: [
          {
            type: 'text',
            text: "Authentication required. Please use the 'auth' tool with action=authenticate first.",
          },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text',
          text: `Error managing tasks: ${error.message}`,
        },
      ],
    };
  }
}

const tasksTools = [
  {
    name: 'manage-tasks',
    description:
      'Manage Microsoft To Do task lists and tasks. action=`list-lists` (default) lists task lists. action=`list` lists tasks in `listId`. action=`create` creates a task in `listId` and requires `title`; optional fields include `body`, `dueDateTime`, and `importance`. action=`update` patches supplied fields on `taskId`. action=`complete` marks a task completed. action=`delete` permanently deletes a task. Use `dryRun: true` with create/update to preview the Graph payload before saving.',
    annotations: {
      title: 'Tasks',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'list-lists',
            'list',
            'create',
            'update',
            'complete',
            'delete',
          ],
          description: 'Action to perform (default: list-lists)',
        },
        listId: {
          type: 'string',
          description:
            'Task list ID (required for list/create/update/complete/delete)',
        },
        taskId: {
          type: 'string',
          description: 'Task ID (required for update/complete/delete)',
        },
        title: {
          type: 'string',
          description: 'Task title (required for create, optional for update)',
        },
        body: {
          type: 'string',
          description: 'Task body/notes (create/update)',
        },
        dueDateTime: {
          type: 'string',
          description: 'Task due date/time in ISO 8601 format (create/update)',
        },
        importance: {
          type: 'string',
          enum: ['low', 'normal', 'high'],
          description: 'Task importance (create/update)',
        },
        count: {
          type: 'number',
          description:
            'Maximum results for list-lists/list (default 50/25, max 100)',
        },
        outputVerbosity: {
          type: 'string',
          enum: ['minimal', 'standard', 'full'],
          description: 'Output detail level (default: standard)',
        },
        dryRun: {
          type: 'boolean',
          description: 'Preview create/update payload without saving',
        },
      },
      additionalProperties: false,
      required: [],
    },
    handler: handleManageTasks,
  },
];

module.exports = {
  tasksTools,
  handleManageTasks,
  buildTaskPayload,
};
