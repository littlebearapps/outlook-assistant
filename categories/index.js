/**
 * Categories module for Outlook MCP server
 *
 * Manages Outlook master categories and Focused Inbox overrides.
 */
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');

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
    let output = [];
    output.push(`# Master Categories (${categories.length})\n`);

    if (outputVerbosity === 'minimal') {
      output.push(categories.map((c) => `- ${c.displayName}`).join('\n'));
    } else {
      output.push('| Category | Color | ID |');
      output.push('|----------|-------|-----|');
      categories.forEach((cat) => {
        const colorName = COLOR_NAMES[cat.color] || cat.color;
        const idDisplay =
          outputVerbosity === 'full' ? cat.id : cat.id.substring(0, 8) + '...';
        output.push(`| ${cat.displayName} | ${colorName} | ${idDisplay} |`);
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
  const { id, displayName, color } = args;

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

    const response = await callGraphAPI(
      accessToken,
      'PATCH',
      `me/outlook/masterCategories/${id}`,
      updateData
    );

    const colorName = COLOR_NAMES[response.color] || response.color;

    return {
      content: [
        {
          type: 'text',
          text: `Category updated!\n\n**Name**: ${response.displayName}\n**Color**: ${colorName} (${response.color})\n**ID**: ${response.id}`,
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
  const { id } = args;

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

  if (!categories || !Array.isArray(categories) || categories.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'Categories array is required. Provide category display names.',
        },
      ],
    };
  }

  const applyAction = action || 'set'; // 'set', 'add', 'remove'

  try {
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
            `me/messages/${id}`,
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

        await callGraphAPI(accessToken, 'PATCH', `me/messages/${id}`, {
          categories: newCategories,
        });

        results.push({ id, success: true, categories: newCategories });
      } catch (err) {
        errors.push({ id, error: err.message });
      }
    }

    let output = [];

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

    let output = [];
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
      'Manage master categories. action=list (default) lists categories. action=create creates a category. action=update changes name/color. action=delete removes a category.',
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
          enum: ['list', 'create', 'update', 'delete'],
          description: 'Action to perform (default: list)',
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
      },
      required: [],
    },
    handler: async (args) => {
      const action = args.action || 'list';
      switch (action) {
        case 'create':
          return handleCreateCategory(args);
        case 'update':
          return handleUpdateCategory(args);
        case 'delete':
          return handleDeleteCategory(args);
        case 'list':
        default:
          return handleListCategories(args);
      }
    },
  },
  {
    name: 'apply-category',
    description: 'Apply, add, or remove categories on email message(s)',
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
      },
      required: ['categories'],
    },
    handler: handleApplyCategory,
  },
  {
    name: 'manage-focused-inbox',
    description:
      'Manage Focused Inbox overrides. action=list (default) shows overrides. action=set creates/updates an override. action=delete removes an override.',
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
        default:
          return handleGetFocusedInboxOverrides(args);
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
