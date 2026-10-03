/**
 * Every tool's inputSchema must be valid JSON Schema 2020-12 and portable
 * across clients (#281).
 *
 * - Claude Code silently drops a tool whose schema doesn't compile.
 * - VS Code strips root-level oneOf/anyOf/allOf and needs `items` on every
 *   array; Gemini's function-calling subset is narrower still.
 */
const Ajv2020 = require('ajv/dist/2020');
const { TOOLS } = require('../tools');

const ajv = new Ajv2020({ strict: false, allErrors: true });

/** Every array-typed subschema, with its JSON pointer. */
function arraySchemas(schema, pointer = '') {
  if (!schema || typeof schema !== 'object') return [];
  const found = [];
  const types = [].concat(schema.type || []);
  if (types.includes('array')) found.push([pointer || '/', schema]);
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'properties' || key === '$defs' || key === 'definitions') {
      for (const [name, sub] of Object.entries(value || {})) {
        found.push(...arraySchemas(sub, `${pointer}/${key}/${name}`));
      }
    } else if (Array.isArray(value)) {
      value.forEach((sub, i) =>
        found.push(...arraySchemas(sub, `${pointer}/${key}/${i}`))
      );
    } else if (value && typeof value === 'object') {
      found.push(...arraySchemas(value, `${pointer}/${key}`));
    }
  }
  return found;
}

describe.each(TOOLS.map((t) => [t.name, t.inputSchema]))(
  '%s inputSchema',
  (_name, schema) => {
    test('is valid against the 2020-12 meta-schema', () => {
      expect(ajv.validateSchema(schema)).toBe(true);
      expect(ajv.errors).toBeNull();
    });

    test('compiles', () => {
      expect(() => ajv.compile(schema)).not.toThrow();
    });

    test('has an object root with no composition keywords', () => {
      expect(schema.type).toBe('object');
      for (const keyword of ['oneOf', 'anyOf', 'allOf', 'not']) {
        expect(schema[keyword]).toBeUndefined();
      }
    });

    test('gives every array an items schema', () => {
      const missing = arraySchemas(schema)
        .filter(([, sub]) => !sub.items)
        .map(([pointer]) => pointer);
      expect(missing).toEqual([]);
    });
  }
);

test('the array walker finds nested arrays without items', () => {
  const schema = {
    type: 'object',
    properties: {
      ok: { type: 'array', items: { type: 'string' } },
      bad: { type: 'object', properties: { list: { type: 'array' } } },
    },
  };
  const missing = arraySchemas(schema)
    .filter(([, sub]) => !sub.items)
    .map(([pointer]) => pointer);
  expect(missing).toEqual(['/properties/bad/properties/list']);
});

test('the meta-schema check rejects an invalid schema', () => {
  expect(
    ajv.validateSchema({
      type: 'object',
      properties: { n: { type: 'strnig' } },
    })
  ).toBe(false);
});
