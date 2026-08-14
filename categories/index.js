/**
 * Categories module for Outlook Assistant server
 *
 * Manages Outlook master categories and Focused Inbox overrides.
 */
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const { buildMailboxPrefix } = require('../utils/mailbox');

// Category color presets (Outlook uses these names)
const CATEGORY_COLORS = [
  'preset0',
  'preset1',
  'preset2',
  'preset3',
  'preset4',
  'preset5',
  'preset6',
  'preset7',
  'preset8',
  'preset9',
  'preset10',
  'preset11',
  'preset12',
  'preset13',
  'preset14',
  'preset15',
  'preset16',
  'preset17',
  'preset18',
  'preset19',
  'preset20',
  'preset21',
  'preset22',
  'preset23',
  'preset24',
];

// Map preset numbers to human-readable colors
const COLOR_NAMES = {
  preset0: 'Red',
  preset1: 'Orange',
  preset2: 'Brown',
  preset3: 'Yellow',
  preset4: 'Green',
  preset5: 'Teal',
  preset6: 'Olive',
  preset7: 'Blue',
  preset8: 'Purple',
  preset9: 'Cranberry',
  preset10: 'Steel',
  preset11: 'DarkSteel',
  preset12: 'Gray',
  preset13: 'DarkGray',
  preset14: 'Black',
  preset15: 'DarkRed',
  preset16: 'DarkOrange',
  preset17: 'DarkBrown',
  preset18: 'DarkYellow',
  preset19: 'DarkGreen',
  preset20: 'DarkTeal',
  preset21: 'DarkOlive',
  preset22: 'DarkBlue',
  preset23: 'DarkPurple',
  preset24: 'DarkCranberry',
};

/**
 * Format a category for display
 */
function formatCategory(category) {
  const colorName = COLOR_NAMES[category.color] || category.color;
  return {
    id: category.id,
    displayName: category.displayName,
    color: category.color,
    colorName: colorName,
  };
}

/**
 * List master categories handler
 */
async function handleListCategories(args) {
  const outputVerbosity = args.outputVerbosity || 'standard';

  try {
    const accessToken = await ensureAuthenticated();

    const response = await callGraphAPI(
      accessToken,
      'GET',
      'me/outlook/masterCategories'
    );

    const categories = response.value || [];

    if (categories.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No categories found. Use manage-category with action=create to create your first category.',
          },
        ],
      };
    }

    // Format output based on verbosity
    const output = [];
    output.push(`# Master Categories (${categories.length})\n`);

    if (outputVerbosity === 'minimal') {
      output.push(categories.map((c) => `- ${c.displayName}`).join('\n'));
    } else {
      output.push('| Category | Color | ID |');
      output.push('|----------|-------|-----|');
      categories.forEach((cat) => {
        const colorName = COLOR_NAMES[cat.color] || cat.color;
        // F-9: emit full IDs at standard verbosity. Truncated IDs were
        // unusable downstream (the ellipsis became part of the copy).
        output.push(`| ${cat.displayName} | ${colorName} | ${cat.id} |`);
      });
    }

    return {
      content: [
        {
          type: 'text',
          text: output.join('\n'),
        },
      ],
      _meta: {
        count: categories.length,
        categories: categories.map(formatCategory),
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
          text: `Error listing categories: ${error.message}`,
        },
      ],
    };
  }
}

/**
 * Create category handler
 */
async function handleCreateCategory(args) {
  const { displayName, color } = args;

  if (!displayName) {
    return {
      content: [
        {
          type: 'text',
          text: 'Category name (displayName) is required.',
        },
      ],
    };
  }

  // Validate color if provided
  if (color && !CATEGORY_COLORS.includes(color)) {
    return {
      content: [
        {
          type: 'text',
          text: `Invalid color. Valid options: ${CATEGORY_COLORS.join(', ')}\n\nColor names: ${Object.entries(
            COLOR_NAMES
          )
            .map(([k, v]) => `${k}=${v}`)
            .join(', ')}`,
        },
      ],
    };
  }

  try {
    const accessToken = await ensureAuthenticated();

    const categoryData = {
      displayName: displayName,
      color: color || 'preset0', // Default to red
    };

    const response = await callGraphAPI(
      accessToken,
      'POST',
      'me/outlook/masterCategories',
      categoryData
    );

    const colorName = COLOR_NAMES[response.color] || response.color;

    return {
      content: [
        {
          type: 'text',
          text: `Category created!\n\n**Name**: ${response.displayName}\n**Color**: ${colorName} (${response.color})\n**ID**: ${response.id}`,
        },
      ],
      _meta: {
        category: formatCategory(response),
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

    if (error.message.includes('already exists')) {
      return {
        content: [
          {
            type: 'text',
            text: `A category named "${displayName}" already exists.`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: `Error creating category: ${error.message}`,
        },
      ],
    };
  }
}

/**
 * Update category handler
 */
async function handleUpdateCategory(args) {
  // F-34: accept `categoryId` as a deprecated alias for `id`.
  const id = args.id || args.categoryId;
  const { displayName, color } = args;

  if (!id) {
    return {
      content: [
        {
          type: 'text',
          text: 'Category ID is required. Use manage-category with action=list to find category IDs.',
        },
      ],
    };
  }

  if (!displayName && !color) {
    return {
      content: [
        {
          type: 'text',
          text: 'At least one of displayName or color must be provided.',
        },
      ],
    };
  }

  // Validate color if provided
  if (color && !CATEGORY_COLORS.includes(color)) {
    return {
      content: [
        {
          type: 'text',
          text: `Invalid color. Valid options: ${CATEGORY_COLORS.join(', ')}`,
        },
      ],
    };
  }

  try {
    const accessToken = await ensureAuthenticated();

    const updateData = {};
    if (displayName) updateData.displayName = displayName;
    if (color) updateData.color = color;

    await callGraphAPI(
      accessToken,
      'PATCH',
      `me/outlook/masterCategories/${id}`,
      updateData
    );

    // F-35: Graph silently drops master-category color updates on
    // some account types. Re-fetch the category and diff requested
    // values against what Graph actually stored, so the caller
    // doesn't get a misleading "Category updated!" when nothing
    // changed.
    const fresh = await callGraphAPI(
      accessToken,
      'GET',
      `me/outlook/masterCategories/${id}`
    );

    const warnings = [];
    if (color && fresh.color !== color) {
      warnings.push(
        `Requested color \`${color}\` but Graph stored \`${fresh.color}\` (master-category colors may be immutable on this account type).`
      );
    }
    if (displayName && fresh.displayName !== displayName) {
      warnings.push(
        `Requested name \`${displayName}\` but Graph stored \`${fresh.displayName}\`.`
      );
    }

    const colorName = COLOR_NAMES[fresh.color] || fresh.color;
    let text = `Category updated!\n\n**Name**: ${fresh.displayName}\n**Color**: ${colorName} (${fresh.color})\n**ID**: ${fresh.id || id}`;
    if (warnings.length > 0) {
      text += `\n\n**⚠ Warning**:\n${warnings.map((w) => `- ${w}`).join('\n')}`;
    }

    return {
      content: [{ type: 'text', text }],
      _meta: { category: formatCategory(fresh) },
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
          text: `Error updating category: ${error.message}`,
        },
      ],
    };
  }
}

/**
 * Delete category handler
 */
async function handleDeleteCategory(args) {
  // F-34: accept `categoryId` as a deprecated alias for `id`.
  const id = args.id || args.categoryId;

  if (!id) {
    return {
      content: [
        {
          type: 'text',
          text: 'Category ID is required. Use manage-category with action=list to find category IDs.',
        },
      ],
    };
  }

  try {
    const accessToken = await ensureAuthenticated();

    await callGraphAPI(
      accessToken,
      'DELETE',
      `me/outlook/masterCategories/${id}`
    );

    return {
      content: [
        {
          type: 'text',
          text: `Category deleted successfully.`,
        },
      ],
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

    if (error.message.includes('not found') || error.message.includes('404')) {
      return {
        content: [
          {
            type: 'text',
            text: `Category not found. Use manage-category with action=list to see available categories.`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: `Error deleting category: ${error.message}`,
        },
      ],
    };
  }
}

/**
 * Apply category to message(s) handler
 */
async function handleApplyCategory(args) {
  const { messageId, messageIds, categories, action } = args;
  const mailbox = args.sharedMailbox || args.email || null;

  // Support single ID or array
  const ids = messageIds || (messageId ? [messageId] : []);

  if (ids.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'Message ID (messageId) or IDs (messageIds) required.',
        },
      ],
    };
  }

  const applyAction = action || 'set'; // 'set', 'add', 'remove'

  if (!categories || !Array.isArray(categories)) {
    return {
      content: [
        {
          type: 'text',
          text: 'Categories array is required. Provide category display names.',
        },
      ],
    };
  }

  // Empty array is only valid for action=set (clears all categories)
  if (categories.length === 0 && applyAction !== 'set') {
    return {
      content: [
        {
          type: 'text',
          text: 'Categories array cannot be empty for add/remove. Use action=set with an empty array to clear all categories.',
        },
      ],
    };
  }

  try {
    // Inside the try so an invalid mailbox returns the handler's normal
    // error object instead of a rejected promise.
    const prefix = buildMailboxPrefix(mailbox);
    const accessToken = await ensureAuthenticated();

    const results = [];
    const errors = [];

    for (const id of ids) {
      try {
        let newCategories = categories;

        // If adding or removing, get current categories first
        if (applyAction === 'add' || applyAction === 'remove') {
          const current = await callGraphAPI(
            accessToken,
            'GET',
            `${prefix}/messages/${id}`,
            null,
            { $select: 'categories' }
          );

          const currentCategories = current.categories || [];

          if (applyAction === 'add') {
            newCategories = [...new Set([...currentCategories, ...categories])];
          } else if (applyAction === 'remove') {
            newCategories = currentCategories.filter(
              (c) => !categories.includes(c)
            );
          }
        }

        await callGraphAPI(accessToken, 'PATCH', `${prefix}/messages/${id}`, {
          categories: newCategories,
        });

        results.push({ id, success: true, categories: newCategories });
      } catch (err) {
        errors.push({ id, error: err.message });
      }
    }

    const output = [];

    if (results.length > 0) {
      output.push(
        `Categories ${applyAction === 'remove' ? 'removed from' : 'applied to'} ${results.length} message(s)\n`
      );

      if (ids.length <= 5) {
        results.forEach((r) => {
          output.push(
            `- ${r.id.substring(0, 20)}...: [${r.categories.join(', ')}]`
          );
        });
      }
    }

    if (errors.length > 0) {
      output.push(`\n${errors.length} error(s):`);
      errors.forEach((e) => {
        output.push(`- ${e.id.substring(0, 20)}...: ${e.error}`);
      });
    }

    return {
      content: [
        {
          type: 'text',
          text: output.join('\n'),
        },
      ],
      _meta: {
        successful: results.length,
        failed: errors.length,
        action: applyAction,
        results,
        errors,
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
          text: `Error applying categories: ${error.message}`,
        },
      ],
    };
  }
}

/**
 * Get Focused Inbox overrides handler
 */
async function handleGetFocusedInboxOverrides(args) {
  const outputVerbosity = args.outputVerbosity || 'standard';

  try {
    const accessToken = await ensureAuthenticated();

    const response = await callGraphAPI(
      accessToken,
      'GET',
      'me/inferenceClassification/overrides'
    );

    const overrides = response.value || [];

    if (overrides.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No Focused Inbox overrides configured.\n\nUse manage-focused-inbox with action=set to always show emails from specific senders in Focused or Other.',
          },
        ],
      };
    }

    const output = [];
    output.push(`# Focused Inbox Overrides (${overrides.length})\n`);

    // Group by classification
    const focused = overrides.filter((o) => o.classifyAs === 'focused');
    const other = overrides.filter((o) => o.classifyAs === 'other');

    if (focused.length > 0) {
      output.push('## Always Focused');
      focused.forEach((o) => {
        const addr = o.senderEmailAddress;
        if (outputVerbosity === 'minimal') {
          output.push(`- ${addr.address}`);
        } else {
          output.push(`- **${addr.name || addr.address}** <${addr.address}>`);
          if (outputVerbosity === 'full') {
            output.push(`  - ID: ${o.id}`);
          }
        }
      });
      output.push('');
    }

    if (other.length > 0) {
      output.push('## Always Other');
      other.forEach((o) => {
        const addr = o.senderEmailAddress;
        if (outputVerbosity === 'minimal') {
          output.push(`- ${addr.address}`);
        } else {
          output.push(`- **${addr.name || addr.address}** <${addr.address}>`);
          if (outputVerbosity === 'full') {
            output.push(`  - ID: ${o.id}`);
          }
        }
      });
    }

    return {
      content: [
        {
          type: 'text',
          text: output.join('\n'),
        },
      ],
      _meta: {
        count: overrides.length,
        focused: focused.length,
        other: other.length,
        overrides: overrides,
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
          text: `Error getting Focused Inbox overrides: ${error.message}`,
        },
      ],
    };
  }
}

/**
 * Set Focused Inbox override handler
 */
async function handleSetFocusedInboxOverride(args) {
  const { emailAddress, name, classifyAs } = args;
  // Note: args.action is used by the consolidated dispatcher and also checked here for 'delete'
  const overrideAction = args.action;

  if (!emailAddress) {
    return {
      content: [
        {
          type: 'text',
          text: 'Email address is required.',
        },
      ],
    };
  }

  const classification = classifyAs || 'focused';
  if (!['focused', 'other'].includes(classification)) {
    return {
      content: [
        {
          type: 'text',
          text: "classifyAs must be 'focused' or 'other'.",
        },
      ],
    };
  }

  try {
    const accessToken = await ensureAuthenticated();

    // Check if override already exists
    const existingResponse = await callGraphAPI(
      accessToken,
      'GET',
      'me/inferenceClassification/overrides'
    );

    const existing = (existingResponse.value || []).find(
      (o) =>
        o.senderEmailAddress.address.toLowerCase() ===
        emailAddress.toLowerCase()
    );

    // Handle delete action
    if (overrideAction === 'delete') {
      if (!existing) {
        return {
          content: [
            {
              type: 'text',
              text: `No override found for ${emailAddress}.`,
            },
          ],
        };
      }

      await callGraphAPI(
        accessToken,
        'DELETE',
        `me/inferenceClassification/overrides/${existing.id}`
      );

      return {
        content: [
          {
            type: 'text',
            text: `Removed override for ${emailAddress}. Emails will now follow normal Focused Inbox rules.`,
          },
        ],
      };
    }

    // Create or update override
    const overrideData = {
      classifyAs: classification,
      senderEmailAddress: {
        address: emailAddress,
        name: name || emailAddress,
      },
    };

    let response;
    if (existing) {
      // Update existing
      response = await callGraphAPI(
        accessToken,
        'PATCH',
        `me/inferenceClassification/overrides/${existing.id}`,
        overrideData
      );
    } else {
      // Create new
      response = await callGraphAPI(
        accessToken,
        'POST',
        'me/inferenceClassification/overrides',
        overrideData
      );
    }

    const actionWord = existing ? 'Updated' : 'Created';
    const destination =
      classification === 'focused' ? 'Focused inbox' : 'Other';

    return {
      content: [
        {
          type: 'text',
          text: `${actionWord} override!\n\nEmails from **${response.senderEmailAddress.name || emailAddress}** <${emailAddress}> will always go to **${destination}**.`,
        },
      ],
      _meta: {
        action: existing ? 'updated' : 'created',
        override: response,
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
          text: `Error setting Focused Inbox override: ${error.message}`,
        },
      ],
    };
  }
}

// Consolidated tool definitions (7 → 3)
const categoriesTools = [
  {
    name: 'manage-category',
    description:
      "Manage the user's master category list (the colour-coded labels available across mail/calendar/contacts). action=`list` (default) returns categories with id/displayName/color. action=`create` adds a new category — `displayName` required, `color` optional (preset0-preset24, e.g. preset0=Red, preset7=Blue). action=`update` (alias `set` — deprecated) changes name/colour by `id`. action=`delete` removes a category — this does NOT untag messages already labelled with it; existing messages retain the orphaned label until manually cleaned. Use `apply-category` to tag/untag specific messages.",
    annotations: {
      title: 'Master Categories',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'create', 'update', 'set', 'delete'],
          description:
            "Action to perform (default: list). 'set' is a deprecated alias for 'update'.",
        },
        // list params
        outputVerbosity: {
          type: 'string',
          enum: ['minimal', 'standard', 'full'],
          description: 'Output detail level (action=list, default: standard)',
        },
        // create/update params
        displayName: {
          type: 'string',
          description:
            'Category name (action=create required, action=update optional)',
        },
        color: {
          type: 'string',
          enum: CATEGORY_COLORS,
          description:
            'Color preset, e.g. preset0=Red, preset7=Blue (action=create/update)',
        },
        // update/delete params
        id: {
          type: 'string',
          description: 'Category ID (action=update/delete, required)',
        },
        categoryId: {
          type: 'string',
          description:
            'DEPRECATED: alias for `id`. Will be removed in a future release.',
        },
      },
      additionalProperties: false,
      required: [],
    },
    handler: async (args) => {
      const action = args.action || 'list';
      switch (action) {
        case 'create':
          return handleCreateCategory(args);
        case 'set': // deprecated alias
        case 'update':
          return handleUpdateCategory(args);
        case 'delete':
          return handleDeleteCategory(args);
        case 'list':
          return handleListCategories(args);
        default:
          return {
            content: [
              {
                type: 'text',
                text: `Unknown action '${action}'. Valid actions: list, create, update, delete.`,
              },
            ],
          };
      }
    },
  },
  {
    name: 'apply-category',
    description:
      "Tag or untag email messages with master categories (those created via `manage-category`). action=`set` (default) replaces the message's category set with the supplied `categories` array. action=`add` appends categories to whatever's already on the message. action=`remove` removes only the named categories, leaving the rest. Accepts either `messageId` (single) or `messageIds` (batch via Graph `$batch`). `categories` are matched by display name — names must already exist in the target mailbox's master list. For your own mailbox, create them via `manage-category` first; for a shared mailbox, the names must already exist there (`manage-category` only manages the signed-in account's master list). Pass `sharedMailbox` (or alias `email`) to categorise messages in a shared/delegated mailbox instead of the signed-in account (requires Mail.ReadWrite.Shared + delegate access). Returns per-message confirmation.",
    annotations: {
      title: 'Apply Categories',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        messageId: {
          type: 'string',
          description: 'Single message ID to categorise',
        },
        messageIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of message IDs to categorise (batch operation)',
        },
        categories: {
          type: 'array',
          items: { type: 'string' },
          description: 'Category display names to apply/remove (required)',
        },
        action: {
          type: 'string',
          enum: ['set', 'add', 'remove'],
          description:
            'set (replace all), add (append), remove (remove specific). Default: set',
        },
        sharedMailbox: {
          type: 'string',
          description:
            'Email address of a shared/delegated mailbox whose messages to categorise instead of the signed-in account. Requires delegate access + Mail.ReadWrite.Shared.',
        },
        email: {
          type: 'string',
          description: 'Alias for `sharedMailbox`.',
        },
      },
      additionalProperties: false,
      required: ['categories'],
    },
    handler: handleApplyCategory,
  },
  {
    name: 'manage-focused-inbox',
    description:
      'Manage Focused Inbox sender overrides — explicit rules that force messages from a given sender into Focused or Other regardless of the ML classifier. action=`list` (default) returns existing overrides with id/sender/classifyAs. action=`set` creates or updates an override for `emailAddress` (optional `name`), routing future mail to `focused` (default) or `other`. action=`delete` removes the override for `emailAddress`. Note: this only works on accounts that have Focused Inbox enabled — personal Outlook.com accounts without it return an empty list.',
    annotations: {
      title: 'Focused Inbox',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'set', 'delete'],
          description: 'Action to perform (default: list)',
        },
        // list params
        outputVerbosity: {
          type: 'string',
          enum: ['minimal', 'standard', 'full'],
          description: 'Output detail level (action=list, default: standard)',
        },
        // set/delete params
        emailAddress: {
          type: 'string',
          description: 'Sender email address (action=set/delete, required)',
        },
        name: {
          type: 'string',
          description: 'Sender display name (action=set)',
        },
        classifyAs: {
          type: 'string',
          enum: ['focused', 'other'],
          description:
            'Where to put emails from this sender (action=set, default: focused)',
        },
      },
      additionalProperties: false,
      required: [],
    },
    handler: async (args) => {
      const action = args.action || 'list';
      switch (action) {
        case 'set':
          return handleSetFocusedInboxOverride(args);
        case 'delete':
          return handleSetFocusedInboxOverride(args);
        case 'list':
          return handleGetFocusedInboxOverrides(args);
        default:
          return {
            content: [
              {
                type: 'text',
                text: `Unknown action '${action}'. Valid actions: list, set, delete.`,
              },
            ],
          };
      }
    },
  },
];

module.exports = {
  categoriesTools,
  handleListCategories,
  handleCreateCategory,
  handleUpdateCategory,
  handleDeleteCategory,
  handleApplyCategory,
  handleGetFocusedInboxOverrides,
  handleSetFocusedInboxOverride,
  CATEGORY_COLORS,
  COLOR_NAMES,
};
