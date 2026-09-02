import { createHash } from 'node:crypto';

export function compareUtf16(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function canonicalJson(value) {
  if (value === null) return 'null';

  const type = typeof value;
  if (type === 'boolean') return value ? 'true' : 'false';
  if (type === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('canonical JSON does not allow non-finite numbers');
    }
    return JSON.stringify(value);
  }
  if (type === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (type === 'object') {
    const keys = Object.keys(value).sort(compareUtf16);
    const parts = [];
    for (const key of keys) {
      const item = value[key];
      if (item === undefined) {
        throw new Error(`canonical JSON does not allow undefined at key ${key}`);
      }
      parts.push(`${JSON.stringify(key)}:${canonicalJson(item)}`);
    }
    return `{${parts.join(',')}}`;
  }

  throw new Error(`canonical JSON does not allow type ${type}`);
}

export function sha256Canonical(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}
