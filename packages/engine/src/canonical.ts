const MAX_DEPTH = 64;

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalizationError';
  }
}

const quotedKeys = new Map<string, string>();

/** Object keys repeat constantly across states, so their JSON form is cached (bounded). */
function quoteKey(key: string): string {
  let quoted = quotedKeys.get(key);
  if (quoted === undefined) {
    quoted = `${JSON.stringify(key)}:`;
    if (quotedKeys.size < 4096) quotedKeys.set(key, quoted);
  }
  return quoted;
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function pathOf(trail: Array<string | number>): string {
  return trail.reduce<string>(
    (path, part) => (typeof part === 'number' ? `${path}[${part}]` : `${path}.${part}`),
    '$',
  );
}

function write(value: unknown, trail: Array<string | number>): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new CanonicalizationError(`non-finite number at ${pathOf(trail)}`);
      }
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (trail.length > MAX_DEPTH) {
        throw new CanonicalizationError(`state is nested too deeply at ${pathOf(trail)}`);
      }
      if (Array.isArray(value)) {
        let out = '[';
        for (let i = 0; i < value.length; i++) {
          trail.push(i);
          out += (i > 0 ? ',' : '') + write(value[i], trail);
          trail.pop();
        }
        return `${out}]`;
      }
      if (!isPlainObject(value)) {
        throw new CanonicalizationError(`non-plain object at ${pathOf(trail)}`);
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record);
      if (keys.length > 1) keys.sort();
      let out = '{';
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i] as string;
        trail.push(key);
        out += (i > 0 ? ',' : '') + quoteKey(key) + write(record[key], trail);
        trail.pop();
      }
      return `${out}}`;
    }
    default:
      throw new CanonicalizationError(`unsupported ${typeof value} at ${pathOf(trail)}`);
  }
}

/**
 * Canonical JSON: object keys sorted by UTF-16 code unit, no whitespace, strict JSON values only.
 * The result is the identity of a state. It never depends on insertion order, time, or randomness.
 */
export function canonicalize(value: unknown): string {
  return write(value, []);
}

/**
 * Short display label for a canonical string (two FNV-1a 32-bit lanes). It is for humans only:
 * the explorer compares full canonical strings, so digest collisions cannot merge states.
 */
export function stateDigest(canonical: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0xa5a5a5a5;
  for (let i = 0; i < canonical.length; i++) {
    const code = canonical.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ (code + i), 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
