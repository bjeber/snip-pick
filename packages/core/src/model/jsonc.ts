/**
 * Minimal JSON-with-comments support. `.code-snippets` files and hand-edited `package.json`
 * siblings routinely carry `//` and trailing commas; `JSON.parse` does not.
 */
export function stripJsonComments(text: string): string {
  let out = '';
  let index = 0;
  let inString = false;
  let escaped = false;

  while (index < text.length) {
    const char = text[index]!;
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      index += 1;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      index += 1;
      continue;
    }
    if (char === '/' && text[index + 1] === '/') {
      const end = text.indexOf('\n', index);
      index = end === -1 ? text.length : end;
      continue;
    }
    if (char === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2);
      index = end === -1 ? text.length : end + 2;
      continue;
    }
    out += char;
    index += 1;
  }

  return removeTrailingCommas(out);
}

function removeTrailingCommas(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === ',') {
      let lookahead = index + 1;
      while (lookahead < text.length && /\s/.test(text[lookahead]!)) lookahead += 1;
      const next = text[lookahead];
      if (next === '}' || next === ']') continue;
    }
    out += char;
  }
  return out;
}

/** `JSON.parse` that tolerates comments and trailing commas. Returns `undefined` on failure. */
export function parseJsonc<T = unknown>(text: string): T | undefined {
  try {
    return JSON.parse(stripJsonComments(text)) as T;
  } catch {
    return undefined;
  }
}
