/**
 * Settings module for Outlook Assistant server
 *
 * Manages mailbox settings, automatic replies (out-of-office),
 * and working hours configuration.
 */
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');

// Days of the week for working hours
const DAYS_OF_WEEK = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

/**
 * Format time for display (HH:MM)
 */
function formatTime(timeString) {
  if (!timeString) return 'Not set';
  // Graph API returns time in ISO format like "08:00:00.0000000"
  return timeString.substring(0, 5);
}

/**
 * Format working hours for display
 */
function formatWorkingHours(workingHours) {
  if (!workingHours) return 'Not configured';

  const lines = [];
  lines.push(`**Time Zone**: ${workingHours.timeZone?.name || 'Not set'}`);
  lines.push(`**Start Time**: ${formatTime(workingHours.startTime)}`);
  lines.push(`**End Time**: ${formatTime(workingHours.endTime)}`);

  if (workingHours.daysOfWeek && workingHours.daysOfWeek.length > 0) {
    const days = workingHours.daysOfWeek.map(
      (d) => d.charAt(0).toUpperCase() + d.slice(1)
    );
    lines.push(`**Work Days**: ${days.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Format automatic replies for display
 */
function formatAutomaticReplies(settings) {
  if (!settings) return 'Not configured';

  const lines = [];
  lines.push(
    `**Status**: ${
      settings.status === 'disabled'
        ? '🔴 Disabled'
        : settings.status === 'alwaysEnabled'
          ? '🟢 Always Enabled'
          : '📅 Scheduled'
    }`
  );

  if (settings.status !== 'disabled') {
    if (settings.scheduledStartDateTime) {
      lines.push(
        `**Scheduled Start**: ${new Date(settings.scheduledStartDateTime.dateTime).toLocaleString()}`
      );
    }
    if (settings.scheduledEndDateTime) {
      lines.push(
        `**Scheduled End**: ${new Date(settings.scheduledEndDateTime.dateTime).toLocaleString()}`
      );
    }

    if (settings.internalReplyMessage) {
      lines.push(
        `\n**Internal Reply**:\n${settings.internalReplyMessage.substring(0, 500)}${settings.internalReplyMessage.length > 500 ? '...' : ''}`
      );
    }

    if (settings.externalReplyMessage) {
      lines.push(
        `\n**External Reply**:\n${settings.externalReplyMessage.substring(0, 500)}${settings.externalReplyMessage.length > 500 ? '...' : ''}`
      );
    }

    lines.push(
      `\n**External Audience**: ${settings.externalAudience || 'none'}`
    );
  }

  return lines.join('\n');
}

/**
 * Get mailbox settings handler
 */
async function handleGetMailboxSettings(args) {
  const section = args.section; // Optional: 'all', 'language', 'timezone', 'workingHours', 'automaticReplies'

  try {
    const accessToken = await ensureAuthenticated();

    let endpoint = 'me/mailboxSettings';
    if (section && section !== 'all') {
      endpoint = `me/mailboxSettings/${section}`;
    }

    const settings = await callGraphAPI(accessToken, 'GET', endpoint);

    let output = [];
    output.push('# Mailbox Settings\n');

    if (section && section !== 'all') {
      // Single section — format based on section type
      const sectionTitle = section.charAt(0).toUpperCase() + section.slice(1);
      output.push(`## ${sectionTitle}\n`);

      if (section === 'workingHours') {
        output.push(formatWorkingHours(settings));
      } else if (section === 'automaticRepliesSetting') {
        output.push(formatAutomaticReplies(settings));
      } else if (section === 'language') {
        output.push(`**Locale**: ${settings.locale || 'Not set'}`);
        output.push(`**Display Name**: ${settings.displayName || 'Not set'}`);
      } else if (section === 'timeZone') {
        output.push(`**Zone**: ${settings}`);
      } else {
        // Fallback for unknown sections
        output.push('```json');
        output.push(JSON.stringify(settings, null, 2));
        output.push('```');
      }
    } else {
      // All settings
      if (settings.language) {
        output.push('## Language');
        output.push(`**Locale**: ${settings.language.locale || 'Not set'}`);
        output.push(
          `**Display Name**: ${settings.language.displayName || 'Not set'}`
        );
        output.push('');
      }

      if (settings.timeZone) {
        output.push('## Time Zone');
        output.push(`**Zone**: ${settings.timeZone}`);
        output.push('');
      }

      if (settings.dateFormat) {
        output.push('## Date/Time Format');
        output.push(`**Date Format**: ${settings.dateFormat}`);
        output.push(`**Time Format**: ${settings.timeFormat || 'Not set'}`);
        output.push('');
      }

      if (settings.workingHours) {
        output.push('## Working Hours');
        output.push(formatWorkingHours(settings.workingHours));
        output.push('');
      }

      if (settings.automaticRepliesSetting) {
        output.push('## Automatic Replies (Out of Office)');
        output.push(formatAutomaticReplies(settings.automaticRepliesSetting));
        output.push('');
      }

      if (settings.delegateMeetingMessageDeliveryOptions) {
        output.push('## Delegate Settings');
        output.push(
          `**Meeting Message Delivery**: ${settings.delegateMeetingMessageDeliveryOptions}`
        );
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: output.join('\n'),
        },
      ],
      _meta: {
        settings,
      },
    };
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
          text: `Error getting mailbox settings: ${error.message}`,
        },
      ],
    };
  }
}

/**
 * Set automatic replies (out of office) handler
 */
async function handleSetAutomaticReplies(args) {
  const {
    enabled,
    startDateTime,
    endDateTime,
    internalReplyMessage,
    externalReplyMessage,
    externalAudience,
  } = args;

  try {
    const accessToken = await ensureAuthenticated();

    // Build the settings object
    const settings = {};

    // Determine status
    if (enabled === false) {
      settings.status = 'disabled';
    } else if (startDateTime && endDateTime) {
      settings.status = 'scheduled';
      settings.scheduledStartDateTime = {
        dateTime: new Date(startDateTime).toISOString(),
        timeZone: 'UTC',
      };
      settings.scheduledEndDateTime = {
        dateTime: new Date(endDateTime).toISOString(),
        timeZone: 'UTC',
      };
    } else if (enabled === true) {
      settings.status = 'alwaysEnabled';
    }

    // Reply messages
    if (internalReplyMessage !== undefined) {
      settings.internalReplyMessage = internalReplyMessage;
    }

    if (externalReplyMessage !== undefined) {
      settings.externalReplyMessage = externalReplyMessage;
    }

    // External audience
    if (externalAudience) {
      if (!['none', 'contactsOnly', 'all'].includes(externalAudience)) {
        return {
          content: [
            {
              type: 'text',
              text: "externalAudience must be 'none', 'contactsOnly', or 'all'.",
            },
          ],
        };
      }
      settings.externalAudience = externalAudience;
    }

    // Apply settings
    await callGraphAPI(accessToken, 'PATCH', 'me/mailboxSettings', {
      automaticRepliesSetting: settings,
    });

    // Get updated settings
    const updated = await callGraphAPI(
      accessToken,
      'GET',
      'me/mailboxSettings/automaticRepliesSetting'
    );

    let output = [];
    output.push('Automatic replies updated!\n');
    output.push(formatAutomaticReplies(updated));

    // Warn if enabling without messages
    if (
      updated.status !== 'disabled' &&
      !internalReplyMessage &&
      !externalReplyMessage
    ) {
      if (updated.internalReplyMessage || updated.externalReplyMessage) {
        const preview = (
          updated.internalReplyMessage || updated.externalReplyMessage
        ).substring(0, 100);
        output.push(
          `\n**Note**: Using previously configured message: "${preview}${preview.length >= 100 ? '...' : ''}"`
        );
      } else {
        output.push(
          '\n**Warning**: Auto-replies enabled with no message configured. Recipients will receive a blank reply.'
        );
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: output.join('\n'),
        },
      ],
      _meta: {
        settings: updated,
      },
    };
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
          text: `Error setting automatic replies: ${error.message}`,
        },
      ],
    };
  }
}

/**
 * Set working hours handler
 */
async function handleSetWorkingHours(args) {
  const { startTime, endTime, daysOfWeek, timeZone } = args;

  // Validate inputs
  if (!startTime && !endTime && !daysOfWeek && !timeZone) {
    return {
      content: [
        {
          type: 'text',
          text: 'At least one of startTime, endTime, daysOfWeek, or timeZone is required.',
        },
      ],
    };
  }

  // Validate time format (HH:MM or HH:MM:SS)
  const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;
  if (startTime && !timeRegex.test(startTime)) {
    return {
      content: [
        {
          type: 'text',
          text: "startTime must be in HH:MM or HH:MM:SS format (e.g., '09:00' or '09:00:00').",
        },
      ],
    };
  }
  if (endTime && !timeRegex.test(endTime)) {
    return {
      content: [
        {
          type: 'text',
          text: "endTime must be in HH:MM or HH:MM:SS format (e.g., '17:00' or '17:00:00').",
        },
      ],
    };
  }

  // Validate days of week
  if (daysOfWeek) {
    const invalidDays = daysOfWeek.filter(
      (d) => !DAYS_OF_WEEK.includes(d.toLowerCase())
    );
    if (invalidDays.length > 0) {
      return {
        content: [
          {
            type: 'text',
            text: `Invalid days: ${invalidDays.join(', ')}. Valid days: ${DAYS_OF_WEEK.join(', ')}`,
          },
        ],
      };
    }
  }

  try {
    const accessToken = await ensureAuthenticated();

    // Get current settings first
    const current = await callGraphAPI(
      accessToken,
      'GET',
      'me/mailboxSettings/workingHours'
    );

    // Build update
    const workingHours = {
      startTime: startTime
        ? startTime.length === 5
          ? startTime + ':00.0000000'
          : startTime + '.0000000'
        : current.startTime,
      endTime: endTime
        ? endTime.length === 5
          ? endTime + ':00.0000000'
          : endTime + '.0000000'
        : current.endTime,
      daysOfWeek: daysOfWeek
        ? daysOfWeek.map((d) => d.toLowerCase())
        : current.daysOfWeek,
      timeZone: timeZone ? { name: timeZone } : current.timeZone,
    };

    // Apply settings
    await callGraphAPI(accessToken, 'PATCH', 'me/mailboxSettings', {
      workingHours,
    });

    // Get updated settings
    const updated = await callGraphAPI(
      accessToken,
      'GET',
      'me/mailboxSettings/workingHours'
    );

    let output = [];
    output.push('Working hours updated!\n');
    output.push(formatWorkingHours(updated));

    return {
      content: [
        {
          type: 'text',
          text: output.join('\n'),
        },
      ],
      _meta: {
        settings: updated,
      },
    };
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
          text: `Error setting working hours: ${error.message}`,
        },
      ],
    };
  }
}

/**
 * Get automatic replies settings handler (standalone)
 */
async function handleGetAutomaticReplies() {
  try {
    const accessToken = await ensureAuthenticated();
    const settings = await callGraphAPI(
      accessToken,
      'GET',
      'me/mailboxSettings/automaticRepliesSetting'
    );

    let output = [];
    output.push('# Automatic Replies\n');
    output.push(formatAutomaticReplies(settings));

    return {
      content: [{ type: 'text', text: output.join('\n') }],
      _meta: { settings },
    };
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
          text: `Error getting automatic replies: ${error.message}`,
        },
      ],
    };
  }
}

/**
 * Get working hours settings handler (standalone)
 */
async function handleGetWorkingHours() {
  try {
    const accessToken = await ensureAuthenticated();
    const settings = await callGraphAPI(
      accessToken,
      'GET',
      'me/mailboxSettings/workingHours'
    );

    let output = [];
    output.push('# Working Hours\n');
    output.push(formatWorkingHours(settings));

    return {
      content: [{ type: 'text', text: output.join('\n') }],
      _meta: { settings },
    };
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
          text: `Error getting working hours: ${error.message}`,
        },
      ],
    };
  }
}

// Consolidated tool definition
const settingsTools = [
  {
    name: 'mailbox-settings',
    description:
      'Manage mailbox settings. action=get (default) retrieves settings (language, timezone, working hours, auto-replies). action=set-auto-replies configures out-of-office. action=set-working-hours configures work schedule.',
    annotations: {
      title: 'Mailbox Settings',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['get', 'set-auto-replies', 'set-working-hours'],
          description: 'Action to perform (default: get)',
        },
        // get params
        section: {
          type: 'string',
          enum: [
            'all',
            'language',
            'timeZone',
            'workingHours',
            'automaticRepliesSetting',
          ],
          description:
            'Specific section to retrieve (action=get, default: all)',
        },
        // set-auto-replies params
        enabled: {
          type: 'boolean',
          description:
            'Enable (true) or disable (false) automatic replies (action=set-auto-replies)',
        },
        startDateTime: {
          type: 'string',
          description:
            'Start date/time for scheduled mode, ISO 8601 format (action=set-auto-replies)',
        },
        endDateTime: {
          type: 'string',
          description:
            'End date/time for scheduled mode, ISO 8601 format (action=set-auto-replies)',
        },
        internalReplyMessage: {
          type: 'string',
          description:
            'Reply message for internal senders (action=set-auto-replies)',
        },
        externalReplyMessage: {
          type: 'string',
          description:
            'Reply message for external senders (action=set-auto-replies)',
        },
        externalAudience: {
          type: 'string',
          enum: ['none', 'contactsOnly', 'all'],
          description: 'Who receives external reply (action=set-auto-replies)',
        },
        // set-working-hours params
        startTime: {
          type: 'string',
          description:
            "Work start time in HH:MM format, e.g. '09:00' (action=set-working-hours)",
        },
        endTime: {
          type: 'string',
          description:
            "Work end time in HH:MM format, e.g. '17:00' (action=set-working-hours)",
        },
        daysOfWeek: {
          type: 'array',
          items: {
            type: 'string',
            enum: DAYS_OF_WEEK,
          },
          description:
            "Work days, e.g. ['monday','tuesday','wednesday','thursday','friday'] (action=set-working-hours)",
        },
        timeZone: {
          type: 'string',
          description:
            "Time zone name, e.g. 'Australia/Melbourne' (action=set-working-hours)",
        },
      },
      required: [],
    },
    handler: async (args) => {
      const action = args.action || 'get';
      switch (action) {
        case 'set-auto-replies':
          return handleSetAutomaticReplies(args);
        case 'set-working-hours':
          return handleSetWorkingHours(args);
        case 'get':
        default:
          return handleGetMailboxSettings(args);
      }
    },
  },
];

module.exports = {
  settingsTools,
  handleGetMailboxSettings,
  handleGetAutomaticReplies,
  handleSetAutomaticReplies,
  handleGetWorkingHours,
  handleSetWorkingHours,
};
