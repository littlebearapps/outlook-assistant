/**
 * MCP boundary schema coercion + validation.
 *
 * Some MCP clients deliver array/boolean/number params as strings (the
 * JSON-RPC marshalling differs across clients). Handlers were written
 * assuming JS-typed values, so these arrive broken — arrays iterate
 * character-by-character, `=== true` fails on `'true'`, etc.
 *
 * This module walks each tool's `inputSchema.properties` once at the
 * MCP entry point and coerces incoming values into the declared types.
 * It also enforces `additionalProperties: false`, top-level enum
 * constraints, and `required`. Anything that fails coercion or
 * validation gets surfaced as an MCP error response before the
 * handler is invoked.
 *
 * Tracks GH #160 (param-shape mismatches) and #162 (unknown-action
 * fallthrough — enums caught here instead of in switch defaults).
 */

class CoercionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CoercionError';
  }
}

/**
 * Coerce a single value against a JSON schema fragment. Mutates nothing.
 * Throws CoercionError on type mismatch that can't be resolved.
 */
function coerceValue(value, schema, path) {
  if (value === undefined || value === null) return value;
  if (!schema || !schema.type) return value;

  const type = schema.type;

  if (type === 'array') {
    let arr = value;
    if (typeof arr === 'string') {
      try {
        arr = JSON.parse(arr);
      } catch (_e) {
        throw new CoercionError(
          `${path}: expected array, got non-JSON string "${truncate(value)}"`
        );
      }
    }
    if (!Array.isArray(arr)) {
      throw new CoercionError(
        `${path}: expected array, got ${describeType(arr)}`
      );
    }
    if (schema.items) {
      return arr.map((item, i) =>
        coerceValue(item, schema.items, `${path}[${i}]`)
      );
    }
    return arr;
  }

  if (type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === 1 || value === '1') return true;
    if (value === 'false' || value === 0 || value === '0') return false;
    throw new CoercionError(
      `${path}: expected boolean, got ${describeType(value)} (${truncate(JSON.stringify(value))})`
    );
  }

  if (type === 'integer') {
    if (typeof value === 'number' && Number.isInteger(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const n = Number(value);
      if (Number.isInteger(n)) return n;
    }
    throw new CoercionError(
      `${path}: expected integer, got ${describeType(value)} (${truncate(JSON.stringify(value))})`
    );
  }

  if (type === 'number') {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const n = Number(value);
      if (!Number.isNaN(n)) return n;
    }
    throw new CoercionError(
      `${path}: expected number, got ${describeType(value)} (${truncate(JSON.stringify(value))})`
    );
  }

  if (type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new CoercionError(
        `${path}: expected object, got ${describeType(value)}`
      );
    }
    if (!schema.properties) return value;
    const result = { ...value };
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (key in value) {
        result[key] = coerceValue(value[key], propSchema, `${path}.${key}`);
      }
    }
    return result;
  }

  // type === 'string' or unknown: pass through
  return value;
}

/**
 * Coerce + validate args against a tool's inputSchema. Returns
 *   { args: <coerced> } on success, or
 *   { error: '<message>' } on failure.
 *
 * Validates (in this order, all errors collected):
 *   1. additionalProperties: false (rejects unknown params)
 *   2. type coercion for each declared property (string→array/boolean/number)
 *   3. required (rejects missing required params)
 *   4. enum on top-level properties (rejects out-of-enum values)
 */
function coerceArgsAgainstSchema(args, inputSchema) {
  if (!inputSchema || !inputSchema.properties) return { args: args || {} };
  const safeArgs = args || {};
  const errors = [];

  // 1. additionalProperties: false
  if (inputSchema.additionalProperties === false) {
    const known = new Set(Object.keys(inputSchema.properties));
    const unknown = Object.keys(safeArgs).filter((k) => !known.has(k));
    if (unknown.length > 0) {
      const validList = [...known].sort().join(', ');
      errors.push(
        `Unknown parameter${unknown.length > 1 ? 's' : ''}: ${unknown
          .map((k) => `'${k}'`)
          .join(', ')}. Valid parameters: ${validList}.`
      );
    }
  }

  // 2. coerce each known property
  const coerced = { ...safeArgs };
  for (const [key, propSchema] of Object.entries(inputSchema.properties)) {
    if (!(key in safeArgs)) continue;
    try {
      coerced[key] = coerceValue(safeArgs[key], propSchema, key);
    } catch (e) {
      if (e instanceof CoercionError) {
        errors.push(e.message);
      } else {
        throw e;
      }
    }
  }

  // 3. required
  if (Array.isArray(inputSchema.required)) {
    for (const key of inputSchema.required) {
      if (
        !(key in safeArgs) ||
        safeArgs[key] === undefined ||
        safeArgs[key] === null ||
        safeArgs[key] === ''
      ) {
        errors.push(`Required parameter '${key}' is missing.`);
      }
    }
  }

  // 4. top-level enum constraints
  for (const [key, propSchema] of Object.entries(inputSchema.properties)) {
    if (!(key in coerced)) continue;
    if (!Array.isArray(propSchema.enum)) continue;
    const v = coerced[key];
    if (v === undefined || v === null) continue;
    if (!propSchema.enum.includes(v)) {
      errors.push(
        `Parameter '${key}': value '${v}' not in allowed values [${propSchema.enum
          .map((x) => `'${x}'`)
          .join(', ')}].`
      );
    }
  }

  if (errors.length > 0) {
    return { error: errors.join('\n') };
  }
  return { args: coerced };
}

function describeType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function truncate(s, n = 60) {
  if (typeof s !== 'string') s = String(s);
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

module.exports = {
  coerceArgsAgainstSchema,
  coerceValue,
  CoercionError,
};
