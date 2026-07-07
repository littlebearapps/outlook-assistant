const {
  coerceArgsAgainstSchema,
  coerceValue,
  CoercionError,
} = require('../../utils/schema-coerce');

describe('schema-coerce', () => {
  describe('coerceValue (single values)', () => {
    test('passes through undefined and null', () => {
      expect(coerceValue(undefined, { type: 'string' }, 'x')).toBeUndefined();
      expect(coerceValue(null, { type: 'string' }, 'x')).toBeNull();
    });

    test('passes through values when no schema or no type', () => {
      expect(coerceValue('hi', null, 'x')).toBe('hi');
      expect(coerceValue('hi', {}, 'x')).toBe('hi');
    });

    describe('array', () => {
      test('passes through real arrays', () => {
        expect(coerceValue(['a', 'b'], { type: 'array' }, 'x')).toEqual([
          'a',
          'b',
        ]);
      });

      test('parses JSON-stringified array (F-25 fix)', () => {
        expect(
          coerceValue(
            '["AQM1", "AQM2"]',
            { type: 'array', items: { type: 'string' } },
            'ids'
          )
        ).toEqual(['AQM1', 'AQM2']);
      });

      test('parses single-element JSON-stringified array (F-33 fix)', () => {
        expect(
          coerceValue(
            '["e2e-test"]',
            { type: 'array', items: { type: 'string' } },
            'categories'
          )
        ).toEqual(['e2e-test']);
      });

      test('throws on non-JSON string', () => {
        expect(() =>
          coerceValue(
            'e2e-test',
            { type: 'array', items: { type: 'string' } },
            'categories'
          )
        ).toThrow(CoercionError);
      });

      test('throws when JSON parses to non-array', () => {
        expect(() => coerceValue('"foo"', { type: 'array' }, 'x')).toThrow(
          /expected array/
        );
      });

      test('coerces array items recursively', () => {
        const result = coerceValue(
          ['true', 'false', '1'],
          { type: 'array', items: { type: 'boolean' } },
          'flags'
        );
        expect(result).toEqual([true, false, true]);
      });
    });

    describe('boolean (F-42 fix)', () => {
      test('passes through real booleans', () => {
        expect(coerceValue(true, { type: 'boolean' }, 'x')).toBe(true);
        expect(coerceValue(false, { type: 'boolean' }, 'x')).toBe(false);
      });

      test('coerces "true" / "false" strings', () => {
        expect(coerceValue('true', { type: 'boolean' }, 'x')).toBe(true);
        expect(coerceValue('false', { type: 'boolean' }, 'x')).toBe(false);
      });

      test('coerces 1 / 0 numbers and "1" / "0" strings', () => {
        expect(coerceValue(1, { type: 'boolean' }, 'x')).toBe(true);
        expect(coerceValue(0, { type: 'boolean' }, 'x')).toBe(false);
        expect(coerceValue('1', { type: 'boolean' }, 'x')).toBe(true);
        expect(coerceValue('0', { type: 'boolean' }, 'x')).toBe(false);
      });

      test('throws on un-coercible values', () => {
        expect(() => coerceValue('yes', { type: 'boolean' }, 'x')).toThrow(
          CoercionError
        );
        expect(() => coerceValue({}, { type: 'boolean' }, 'x')).toThrow(
          CoercionError
        );
      });
    });

    describe('integer / number', () => {
      test('coerces numeric strings to integers', () => {
        expect(coerceValue('25', { type: 'integer' }, 'x')).toBe(25);
        expect(coerceValue(' 25 ', { type: 'integer' }, 'x')).toBe(25);
      });

      test('rejects non-integer floats', () => {
        expect(() => coerceValue('25.5', { type: 'integer' }, 'x')).toThrow();
      });

      test('coerces numeric strings to numbers', () => {
        expect(coerceValue('25.5', { type: 'number' }, 'x')).toBe(25.5);
      });
    });

    describe('object (recursive)', () => {
      test('recurses into object properties', () => {
        const schema = {
          type: 'object',
          properties: {
            count: { type: 'integer' },
            enabled: { type: 'boolean' },
          },
        };
        expect(
          coerceValue({ count: '5', enabled: 'true' }, schema, 'searchQuery')
        ).toEqual({ count: 5, enabled: true });
      });

      test('preserves unknown nested properties', () => {
        const schema = {
          type: 'object',
          properties: { x: { type: 'integer' } },
        };
        expect(coerceValue({ x: '1', extra: 'kept' }, schema, 'q')).toEqual({
          x: 1,
          extra: 'kept',
        });
      });

      test('rejects unknown nested properties when additionalProperties is false', () => {
        const schema = {
          type: 'object',
          properties: { x: { type: 'integer' } },
          additionalProperties: false,
        };
        expect(() =>
          coerceValue({ x: '1', extra: 'blocked' }, schema, 'q')
        ).toThrow(/q: unknown property 'extra'/);
      });

      test('enforces nested required properties', () => {
        const schema = {
          type: 'object',
          properties: { x: { type: 'integer' } },
          required: ['x'],
        };
        expect(() => coerceValue({}, schema, 'q')).toThrow(
          /q: required property 'x' is missing/
        );
      });
    });

    describe('string (F-24 fix)', () => {
      test('passes through real strings', () => {
        expect(coerceValue('hi', { type: 'string' }, 'to')).toBe('hi');
      });

      test('passes through empty string', () => {
        expect(coerceValue('', { type: 'string' }, 'to')).toBe('');
      });

      test('rejects array passed to string-typed param with helpful hint', () => {
        expect(() =>
          coerceValue(['a@example.com'], { type: 'string' }, 'to')
        ).toThrow(/expected comma-separated string, got array/);
      });

      test('rejects multi-element array on string-typed param', () => {
        expect(() =>
          coerceValue(
            ['a@example.com', 'b@example.com'],
            { type: 'string' },
            'to'
          )
        ).toThrow(CoercionError);
      });

      // #168: MCP clients that JSON-stringify array literals before
      // transmission deliver the array as a literal-bracket string. The
      // first F-24 fix (Array.isArray) only caught the live-array form;
      // the v3.7.3 E2E sweep showed the user-visible failure mode
      // (Graph 400 ErrorInvalidRecipients) was still reproducible.
      test('rejects JSON-stringified array (transport-encoded form)', () => {
        expect(() =>
          coerceValue('["a@example.com"]', { type: 'string' }, 'to')
        ).toThrow(/JSON-encoded array.*"a@example.com"/);
      });

      test('rejects JSON-stringified multi-element array with usable hint', () => {
        expect(() =>
          coerceValue(
            '["a@example.com","b@example.com"]',
            { type: 'string' },
            'to'
          )
        ).toThrow(/JSON-encoded array.*"a@example.com,b@example.com"/);
      });

      test('handles whitespace around JSON-stringified array', () => {
        expect(() =>
          coerceValue('  ["a@x.com"]  ', { type: 'string' }, 'to')
        ).toThrow(CoercionError);
      });

      test('passes through strings that merely start with [ but are not JSON arrays', () => {
        // Subject lines or body text legitimately starting with `[` (e.g.
        // notification subjects like `[GitHub] ...`) must not trip the guard.
        expect(
          coerceValue('[GitHub] PR opened', { type: 'string' }, 'subject')
        ).toBe('[GitHub] PR opened');
      });

      test('passes through bracketed non-array JSON like "[1,2"', () => {
        // Malformed brackets shouldn't fall foul of the guard — only
        // *parseable* arrays are rejected. Other non-JSON content passes.
        expect(coerceValue('[unclosed', { type: 'string' }, 'subject')).toBe(
          '[unclosed'
        );
      });
    });
  });

  describe('coerceArgsAgainstSchema (full args)', () => {
    test('returns args unchanged when no schema', () => {
      expect(coerceArgsAgainstSchema({ x: 1 }, null)).toEqual({
        args: { x: 1 },
      });
      expect(coerceArgsAgainstSchema({ x: 1 }, {})).toEqual({ args: { x: 1 } });
    });

    test('handles missing args object', () => {
      expect(coerceArgsAgainstSchema(undefined, { properties: {} })).toEqual({
        args: {},
      });
    });

    test('coerces multiple typed properties at once', () => {
      const schema = {
        properties: {
          ids: { type: 'array', items: { type: 'string' } },
          isEnabled: { type: 'boolean' },
          maxResults: { type: 'integer' },
          name: { type: 'string' },
        },
      };
      const result = coerceArgsAgainstSchema(
        {
          ids: '["a","b"]',
          isEnabled: 'true',
          maxResults: '10',
          name: 'rule-1',
        },
        schema
      );
      expect(result.error).toBeUndefined();
      expect(result.args).toEqual({
        ids: ['a', 'b'],
        isEnabled: true,
        maxResults: 10,
        name: 'rule-1',
      });
    });

    describe('additionalProperties: false (F-10 fix)', () => {
      test('rejects unknown params when set to false', () => {
        const schema = {
          properties: { action: { type: 'string' } },
          additionalProperties: false,
        };
        const result = coerceArgsAgainstSchema(
          { action: 'list', verbosity: 'full' },
          schema
        );
        expect(result.error).toMatch(/Unknown parameter.*'verbosity'/);
        expect(result.error).toMatch(/Valid parameters: action/);
      });

      test('allows unknown params when not set', () => {
        const schema = { properties: { action: { type: 'string' } } };
        const result = coerceArgsAgainstSchema(
          { action: 'list', extra: 'ok' },
          schema
        );
        expect(result.error).toBeUndefined();
        expect(result.args).toEqual({ action: 'list', extra: 'ok' });
      });

      test('lists multiple unknown params with pluralisation', () => {
        const schema = {
          properties: { action: { type: 'string' } },
          additionalProperties: false,
        };
        const result = coerceArgsAgainstSchema(
          { action: 'list', a: 1, b: 2 },
          schema
        );
        expect(result.error).toMatch(/Unknown parameters: 'a', 'b'/);
      });
    });

    describe('required validation', () => {
      test('rejects missing required params', () => {
        const schema = {
          properties: { id: { type: 'string' }, action: { type: 'string' } },
          required: ['id', 'action'],
        };
        const result = coerceArgsAgainstSchema({ action: 'flag' }, schema);
        expect(result.error).toMatch(/Required parameter 'id' is missing/);
      });

      test('rejects empty-string required params', () => {
        const schema = {
          properties: { id: { type: 'string' } },
          required: ['id'],
        };
        const result = coerceArgsAgainstSchema({ id: '' }, schema);
        expect(result.error).toMatch(/Required parameter 'id' is missing/);
      });
    });

    describe('enum validation (F-5 / F-32 boundary)', () => {
      test('rejects out-of-enum value', () => {
        const schema = {
          properties: {
            action: { type: 'string', enum: ['get', 'set-auto-replies'] },
          },
        };
        const result = coerceArgsAgainstSchema(
          { action: 'set-auto-reply' },
          schema
        );
        expect(result.error).toMatch(
          /value 'set-auto-reply' not in allowed values/
        );
      });

      test('allows undefined enum value', () => {
        const schema = {
          properties: { action: { type: 'string', enum: ['list', 'create'] } },
        };
        const result = coerceArgsAgainstSchema({}, schema);
        expect(result.error).toBeUndefined();
      });

      test('accepts enum value present', () => {
        const schema = {
          properties: { action: { type: 'string', enum: ['list', 'create'] } },
        };
        const result = coerceArgsAgainstSchema({ action: 'create' }, schema);
        expect(result.error).toBeUndefined();
        expect(result.args.action).toBe('create');
      });

      test('rejects out-of-enum nested value', () => {
        const schema = {
          properties: {
            recurrenceRaw: {
              type: 'object',
              properties: {
                pattern: {
                  type: 'object',
                  properties: {
                    type: {
                      type: 'string',
                      enum: ['daily', 'weekly'],
                    },
                  },
                  required: ['type'],
                  additionalProperties: false,
                },
              },
              required: ['pattern'],
              additionalProperties: false,
            },
          },
        };

        const result = coerceArgsAgainstSchema(
          { recurrenceRaw: { pattern: { type: 'hourly' } } },
          schema
        );

        expect(result.error).toMatch(
          /recurrenceRaw\.pattern\.type: value 'hourly' not in allowed values/
        );
      });
    });

    describe('integration: real tool schemas with bug-report payloads', () => {
      // Mock the auth so requiring email/index.js etc. doesn't blow up
      jest.mock('../../auth', () => ({
        ensureAuthenticated: jest.fn().mockResolvedValue('test-token'),
      }));

      test('update-email: ids as JSON string is coerced to array (F-25)', () => {
        const { emailTools } = require('../../email');
        const updateEmail = emailTools.find((t) => t.name === 'update-email');
        const result = coerceArgsAgainstSchema(
          { action: 'flag', ids: '["AQM1","AQM2","AQM3"]' },
          updateEmail.inputSchema
        );
        expect(result.error).toBeUndefined();
        expect(result.args.ids).toEqual(['AQM1', 'AQM2', 'AQM3']);
        expect(result.args.action).toBe('flag');
      });

      test('apply-category: categories as JSON string is coerced (F-33/F-36)', () => {
        const { categoriesTools } = require('../../categories');
        const applyCategory = categoriesTools.find(
          (t) => t.name === 'apply-category'
        );
        const result = coerceArgsAgainstSchema(
          { messageId: 'msg-1', categories: '["e2e-test"]' },
          applyCategory.inputSchema
        );
        expect(result.error).toBeUndefined();
        expect(result.args.categories).toEqual(['e2e-test']);
      });

      test('manage-rules: boolean params as strings are coerced (F-42)', () => {
        const { rulesTools } = require('../../rules');
        const manageRules = rulesTools.find((t) => t.name === 'manage-rules');
        const result = coerceArgsAgainstSchema(
          { action: 'list', includeDetails: 'true' },
          manageRules.inputSchema
        );
        expect(result.error).toBeUndefined();
        expect(result.args.includeDetails).toBe(true);
      });

      test('manage-rules: isEnabled=false coerced from string', () => {
        const { rulesTools } = require('../../rules');
        const manageRules = rulesTools.find((t) => t.name === 'manage-rules');
        const result = coerceArgsAgainstSchema(
          { action: 'update', ruleName: 'foo', isEnabled: 'false' },
          manageRules.inputSchema
        );
        expect(result.error).toBeUndefined();
        expect(result.args.isEnabled).toBe(false);
      });

      test('mailbox-settings: typo action is rejected via enum (F-5)', () => {
        const { settingsTools } = require('../../settings');
        const mailbox = settingsTools.find(
          (t) => t.name === 'mailbox-settings'
        );
        const result = coerceArgsAgainstSchema(
          { action: 'set-auto-reply' }, // singular typo
          mailbox.inputSchema
        );
        expect(result.error).toMatch(
          /value 'set-auto-reply' not in allowed values/
        );
      });

      test('folders: unknown param is rejected (F-10)', () => {
        const { folderTools } = require('../../folder');
        const folders = folderTools.find((t) => t.name === 'folders');
        const result = coerceArgsAgainstSchema(
          { action: 'list', verbosity: 'full' },
          folders.inputSchema
        );
        expect(result.error).toMatch(/Unknown parameter.*'verbosity'/);
      });

      test('search-emails: maxResults as string is coerced to integer (F-17 boundary)', () => {
        const { emailTools } = require('../../email');
        const search = emailTools.find((t) => t.name === 'search-emails');
        const result = coerceArgsAgainstSchema(
          { folder: 'junk', maxResults: '5' },
          search.inputSchema
        );
        expect(result.error).toBeUndefined();
        // maxResults schema is `type: 'number'` in this codebase — coerced fine
        expect(typeof result.args.maxResults).toBe('number');
        expect(result.args.maxResults).toBe(5);
      });

      test('create-event: unknown recurrenceRaw sub-param is rejected', () => {
        const { calendarTools } = require('../../calendar');
        const createEvent = calendarTools.find(
          (t) => t.name === 'create-event'
        );
        const result = coerceArgsAgainstSchema(
          {
            subject: 'Recurring test',
            start: '2026-04-14T09:00:00',
            end: '2026-04-14T09:30:00',
            recurrenceRaw: {
              pattern: {
                type: 'weekly',
                interval: 1,
                daysOfWeek: ['monday'],
                unsupported: true,
              },
              range: {
                type: 'numbered',
                startDate: '2026-04-14',
                numberOfOccurrences: 2,
              },
            },
          },
          createEvent.inputSchema
        );

        expect(result.error).toMatch(
          /recurrenceRaw\.pattern: unknown property 'unsupported'/
        );
      });
    });

    test('aggregates multiple errors with newlines', () => {
      const schema = {
        properties: {
          ids: { type: 'array' },
          enabled: { type: 'boolean' },
        },
        required: ['ids'],
        additionalProperties: false,
      };
      const result = coerceArgsAgainstSchema(
        { enabled: 'maybe', extra: 1 },
        schema
      );
      expect(result.error).toMatch(/Unknown parameter/);
      expect(result.error).toMatch(/expected boolean/);
      expect(result.error).toMatch(/Required parameter 'ids' is missing/);
    });
  });
});
