const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');
const { handleManageTasks } = require('../../tasks');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');

const mockAccessToken = 'test-token';

const mockList = {
  id: 'list-1',
  displayName: 'Tasks',
  isOwner: true,
  isShared: false,
  wellknownListName: 'defaultList',
};

const mockTask = {
  id: 'task-1',
  title: 'Review PR #88',
  status: 'notStarted',
  importance: 'high',
  createdDateTime: '2026-07-08T00:00:00Z',
  lastModifiedDateTime: '2026-07-08T00:00:00Z',
  dueDateTime: {
    dateTime: '2026-07-09T09:00:00',
    timeZone: 'Australia/Sydney',
  },
  body: {
    content: 'Check the release notes',
    contentType: 'text',
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.OUTLOOK_MAX_MANAGE_TASKS_PER_SESSION;
  ensureAuthenticated.mockResolvedValue(mockAccessToken);
});

describe('manage-tasks', () => {
  test('list-lists returns task lists', async () => {
    callGraphAPI.mockResolvedValue({ value: [mockList] });

    const result = await handleManageTasks({ action: 'list-lists' });

    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'GET',
      'me/todo/lists'
    );
    expect(result.content[0].text).toContain('# Task Lists');
    expect(result.content[0].text).toContain('Tasks');
    expect(result._meta.count).toBe(1);
  });

  test('list returns tasks in a list', async () => {
    callGraphAPI.mockResolvedValue({ value: [mockTask] });

    const result = await handleManageTasks({
      action: 'list',
      listId: 'list-1',
      count: 10,
    });

    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'GET',
      'me/todo/lists/list-1/tasks'
    );
    expect(result.content[0].text).toContain('# Tasks');
    expect(result.content[0].text).toContain('Review PR #88');
    expect(result._meta.count).toBe(1);
  });

  test('create supports dryRun without Graph mutation', async () => {
    const result = await handleManageTasks({
      action: 'create',
      listId: 'list-1',
      title: 'Review PR #88',
      body: 'Check the release notes',
      dryRun: true,
    });

    expect(result.content[0].text).toContain('DRY RUN');
    expect(result.content[0].text).toContain('Review PR #88');
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  test('create posts a todoTask payload', async () => {
    callGraphAPI.mockResolvedValue(mockTask);

    const result = await handleManageTasks({
      action: 'create',
      listId: 'list-1',
      title: 'Review PR #88',
      body: 'Check the release notes',
      dueDateTime: '2026-07-09T09:00:00Z',
      importance: 'high',
    });

    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'POST',
      'me/todo/lists/list-1/tasks',
      expect.objectContaining({
        title: 'Review PR #88',
        importance: 'high',
        body: {
          content: 'Check the release notes',
          contentType: 'text',
        },
        dueDateTime: {
          dateTime: '2026-07-09T09:00:00',
          timeZone: 'Australia/Melbourne',
        },
      })
    );
    expect(result.content[0].text).toContain('# Task Created');
    expect(result._meta.taskId).toBe('task-1');
  });

  test('update patches only supplied fields', async () => {
    callGraphAPI.mockResolvedValue({ ...mockTask, title: 'Updated task' });

    await handleManageTasks({
      action: 'update',
      listId: 'list-1',
      taskId: 'task-1',
      title: 'Updated task',
    });

    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'PATCH',
      'me/todo/lists/list-1/tasks/task-1',
      { title: 'Updated task' }
    );
  });

  test('complete marks task completed', async () => {
    callGraphAPI.mockResolvedValue({ ...mockTask, status: 'completed' });

    const result = await handleManageTasks({
      action: 'complete',
      listId: 'list-1',
      taskId: 'task-1',
    });

    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'PATCH',
      'me/todo/lists/list-1/tasks/task-1',
      { status: 'completed' }
    );
    expect(result.content[0].text).toContain('# Task Completed');
  });

  test('delete removes a task', async () => {
    callGraphAPI.mockResolvedValue({});

    const result = await handleManageTasks({
      action: 'delete',
      listId: 'list-1',
      taskId: 'task-1',
    });

    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'DELETE',
      'me/todo/lists/list-1/tasks/task-1'
    );
    expect(result.content[0].text).toContain('# Task Deleted');
    expect(result._meta.deleted).toBe(true);
  });

  test('mutating actions respect manage-tasks rate limit', async () => {
    process.env.OUTLOOK_MAX_MANAGE_TASKS_PER_SESSION = '1';
    callGraphAPI.mockResolvedValue(mockTask);

    await handleManageTasks({
      action: 'create',
      listId: 'list-1',
      title: 'Allowed task',
    });
    const blocked = await handleManageTasks({
      action: 'create',
      listId: 'list-1',
      title: 'Blocked task',
    });

    expect(blocked.content[0].text).toContain('Rate limit reached: 1');
    expect(callGraphAPI).toHaveBeenCalledTimes(1);
  });
});
