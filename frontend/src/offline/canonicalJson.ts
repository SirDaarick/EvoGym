export class CanonicalJsonError extends Error {}

function encode(value: unknown, path: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string': return JSON.stringify(value);
    case 'boolean': return value ? 'true' : 'false';
    case 'number':
      if (!Number.isInteger(value)) throw new CanonicalJsonError(`non-integer number at ${path}`);
      if (!Number.isSafeInteger(value)) throw new CanonicalJsonError(`unsafe integer at ${path}`);
      return Object.is(value, -0) ? '0' : String(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((v, i) => encode(v, `${path}[${i}]`)).join(',')}]`;
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      return `{${keys.map((k) => {
        if (obj[k] === undefined) throw new CanonicalJsonError(`undefined value at ${path}.${k}`);
        return `${JSON.stringify(k)}:${encode(obj[k], `${path}.${k}`)}`;
      }).join(',')}}`;
    }
    default: throw new CanonicalJsonError(`unsupported ${typeof value} at ${path}`);
  }
}

export function canonicalJson(value: unknown): string {
  return encode(value, '$');
}

export async function payloadHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
