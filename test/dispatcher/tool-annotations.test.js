process.env.OUTLOOK_CLIENT_ID = 'test-client-id';

const { authTools } = require('../../auth');
const { calendarTools } = require('../../calendar');
const { emailTools } = require('../../email');
const { folderTools } = require('../../folder');
const { rulesTools } = require('../../rules');
const { contactsTools } = require('../../contacts');
const { categoriesTools } = require('../../categories');
const { settingsTools } = require('../../settings');
const { advancedTools } = require('../../advanced');

const allTools = [
  ...authTools,
  ...calendarTools,
  ...emailTools,
  ...folderTools,
  ...rulesTools,
  ...contactsTools,
  ...categoriesTools,
  ...settingsTools,
  ...advancedTools,
];

const expectedAnnotations = {
  auth: {
    title: 'Authentication',
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  'list-events': {
    title: 'List Calendar Events',
    readOnlyHint: true,
    openWorldHint: false,
  },
  'create-event': {
    title: 'Create Calendar Event',
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  'manage-event': {
    title: 'Manage Calendar Event',
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  'search-emails': {
    title: 'Search Emails',
    readOnlyHint: true,
    openWorldHint: true,
  },
  'read-email': {
    title: 'Read Email',
    readOnlyHint: true,
    openWorldHint: true,
  },
  'send-email': {
    title: 'Send Email',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  draft: {
    title: 'Draft Operations',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  'update-email': {
    title: 'Update Email',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  attachments: {
    title: 'Attachments',
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  export: {
    title: 'Export Emails',
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  'get-mail-tips': {
    title: 'Mail Tips',
    readOnlyHint: true,
    openWorldHint: false,
  },
  folders: {
    title: 'Mail Folders',
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  'manage-rules': {
    title: 'Inbox Rules',
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  'manage-contact': {
    title: 'Contacts',
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  'search-people': {
    title: 'People Search',
    readOnlyHint: true,
    openWorldHint: true,
  },
  'manage-category': {
    title: 'Master Categories',
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  'apply-category': {
    title: 'Apply Categories',
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  'manage-focused-inbox': {
    title: 'Focused Inbox',
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  'mailbox-settings': {
    title: 'Mailbox Settings',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  'access-shared-mailbox': {
    title: 'Shared Mailbox',
    readOnlyHint: true,
    openWorldHint: true,
  },
  'find-meeting-rooms': {
    title: 'Meeting Rooms',
    readOnlyHint: true,
    openWorldHint: false,
  },
  'find-meeting-times': {
    title: 'Find Meeting Times',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

describe('tool annotations', () => {
  test('pin expected annotations for all tools', () => {
    expect(allTools).toHaveLength(23);

    const toolsByName = Object.fromEntries(
      allTools.map((tool) => [tool.name, tool])
    );

    expect(Object.keys(toolsByName).sort()).toEqual(
      Object.keys(expectedAnnotations).sort()
    );

    for (const [name, annotations] of Object.entries(expectedAnnotations)) {
      expect(toolsByName[name].annotations).toEqual(annotations);
      expect(toolsByName[name].annotations).toHaveProperty('openWorldHint');
    }
  });
});
