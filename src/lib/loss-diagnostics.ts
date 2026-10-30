/** Closed, content-free historical capture-loss observations. */
import type { LiskaLossDiagnosticCode } from './types';

export const LISKA_LOSS_DIAGNOSTICS_SCHEMA = 1;
export const LISKA_LOSS_DIAGNOSTIC_CODES = [
  'claude-artifact-content-omitted',
  'history-load-partial',
  'image-capture-failed',
] as const satisfies readonly LiskaLossDiagnosticCode[];

export const LISKA_LOSS_DIAGNOSTICS_UNTRUSTED = 'liska-loss-diagnostics-untrusted';

/** Never replace a malformed/future owned block with a weaker interpretation. */
export class LiskaLossDiagnosticsBoundaryError extends Error {
  readonly code = LISKA_LOSS_DIAGNOSTICS_UNTRUSTED;

  constructor() {
    super(LISKA_LOSS_DIAGNOSTICS_UNTRUSTED);
    this.name = 'LiskaLossDiagnosticsBoundaryError';
  }
}

export function isLiskaLossDiagnosticCode(value: unknown): value is LiskaLossDiagnosticCode {
  return (
    typeof value === 'string' &&
    LISKA_LOSS_DIAGNOSTIC_CODES.includes(value as LiskaLossDiagnosticCode)
  );
}

/** JSON-shaped arrays only: no accessors, hidden indices, extras, or inherited data. */
export function isLiskaLossDiagnostics(value: unknown): value is LiskaLossDiagnosticCode[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > LISKA_LOSS_DIAGNOSTIC_CODES.length ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    return false;
  }
  const keys = Object.getOwnPropertyNames(value);
  if (keys.length !== value.length + 1 || !keys.includes('length')) return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !('value' in descriptor) ||
      !isLiskaLossDiagnosticCode(descriptor.value)
    ) {
      return false;
    }
  }
  return true;
}

export function normalizeLiskaLossDiagnostics(
  values: readonly LiskaLossDiagnosticCode[] | undefined
): LiskaLossDiagnosticCode[] {
  if (values === undefined) return [];
  if (!isLiskaLossDiagnostics(values)) throw new LiskaLossDiagnosticsBoundaryError();
  return [...new Set(values)].sort();
}

export function mergeLiskaLossDiagnostics(
  ...sets: (readonly LiskaLossDiagnosticCode[] | undefined)[]
): LiskaLossDiagnosticCode[] {
  const merged = new Set<LiskaLossDiagnosticCode>();
  for (const values of sets) {
    for (const value of normalizeLiskaLossDiagnostics(values)) merged.add(value);
  }
  return [...merged].sort();
}

/** Validate the optional note field before JSON serialization can invoke it. */
export function hasValidLiskaLossDiagnosticsField(frontmatter: object): boolean {
  const key = 'liska_loss_diagnostics';
  const descriptor = Object.getOwnPropertyDescriptor(frontmatter, key);
  if (!descriptor) return !(key in frontmatter);
  return (
    descriptor.enumerable === true &&
    'value' in descriptor &&
    isLiskaLossDiagnostics(descriptor.value)
  );
}

const SCHEMA_KEY = 'liska_loss_diagnostics_schema';
const DIAGNOSTICS_KEY = 'liska_loss_diagnostics';

interface OwnedBlock {
  schemaLine: number | null;
  listStart: number | null;
  listEnd: number | null;
  codes: LiskaLossDiagnosticCode[];
}

function readDiagnosticList(
  lines: readonly string[],
  start: number
): { end: number; codes: LiskaLossDiagnosticCode[] } {
  const codes: LiskaLossDiagnosticCode[] = [];
  let end = start + 1;
  while (end < lines.length - 1 && /^(?:\s|-)/.test(lines[end])) {
    const item = lines[end].match(/^ {2}- (["']?)([a-z-]+)\1$/);
    const code = item?.[2];
    if (!isLiskaLossDiagnosticCode(code) || codes.includes(code)) {
      throw new LiskaLossDiagnosticsBoundaryError();
    }
    codes.push(code);
    end += 1;
  }
  if (codes.length === 0) throw new LiskaLossDiagnosticsBoundaryError();
  let following = end;
  while (
    following < lines.length - 1 &&
    (lines[following].trim() === '' || /^\s*#/.test(lines[following]))
  ) {
    following += 1;
  }
  if (following < lines.length - 1 && /^(?:\s|-)/.test(lines[following])) {
    throw new LiskaLossDiagnosticsBoundaryError();
  }
  return { end, codes };
}

function decodeYamlHexEscapes(value: string): string {
  return value
    .replace(/\\\n[ \t]*/g, '')
    .replace(/\\x([0-9a-fA-F]{2})/g, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/\\U([0-9a-fA-F]{8})/g, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    );
}

function decodeQuotedKeyToken(token: string): string | null {
  const doubleQuoted = token.match(/^"((?:\\.|[^"\\])*)"$/);
  if (doubleQuoted) {
    try {
      const jsonCompatible = decodeYamlHexEscapes(doubleQuoted[1]);
      return JSON.parse(`"${jsonCompatible}"`) as string;
    } catch {
      return null;
    }
  }
  const singleQuoted = token.match(/^'((?:''|[^'])*)'$/);
  return singleQuoted ? singleQuoted[1].replace(/''/g, "'") : null;
}

function decodedQuotedKey(line: string): string | null {
  const key = line.match(/^((?:"(?:\\.|[^"\\])*")|(?:'(?:''|[^'])*'))\s*:/);
  return key ? decodeQuotedKeyToken(key[1]) : null;
}

function decodedExplicitKey(line: string): string | null {
  const rawKey = line.match(/^\?\s+(.+?)\s*$/)?.[1];
  if (!rawKey) return null;
  const key = rawKey.replace(/\s+#.*$/, '').trim();
  if (key === SCHEMA_KEY || key === DIAGNOSTICS_KEY) return key;
  return decodeQuotedKeyToken(key);
}

function assertNoUnownedKeyReferences(lines: readonly string[], block: OwnedBlock): void {
  const unowned = lines
    .map((line, index) => {
      if (index === block.schemaLine || index === block.listStart) return '';
      if (
        block.listStart !== null &&
        block.listEnd !== null &&
        index > block.listStart &&
        index < block.listEnd
      ) {
        return '';
      }
      return line;
    })
    .join('\n');
  const ownedKeyFamily =
    /liska(?:_|\s)+loss(?:_|\s)+diagnostics(?:_|\s)+schema|liska(?:_|\s)+loss(?:_|\s)+diagnostics/;
  if (ownedKeyFamily.test(decodeYamlHexEscapes(unowned))) {
    throw new LiskaLossDiagnosticsBoundaryError();
  }
}

/** Accept only the exact versioned flat-list form Liska writes. */
function readOwnedBlock(lines: readonly string[]): OwnedBlock {
  const block: OwnedBlock = { schemaLine: null, listStart: null, listEnd: null, codes: [] };
  for (let index = 1; index < lines.length - 1; index += 1) {
    const line = lines[index];
    const quotedKey = decodedQuotedKey(line);
    const explicitKey = decodedExplicitKey(line);
    if (
      quotedKey === SCHEMA_KEY ||
      quotedKey === DIAGNOSTICS_KEY ||
      explicitKey === SCHEMA_KEY ||
      explicitKey === DIAGNOSTICS_KEY
    ) {
      throw new LiskaLossDiagnosticsBoundaryError();
    }
    // Only key positions are owned; an unrelated title/value may name a key.
    // Quoted, indented, or otherwise malformed key spellings remain ambiguous.
    if (!/^\s*["']?liska_loss_diagnostics(?:_schema)?["']?\s*:/.test(line)) continue;
    if (line.startsWith(`${SCHEMA_KEY}:`)) {
      if (block.schemaLine !== null || line !== `${SCHEMA_KEY}: 1`) {
        throw new LiskaLossDiagnosticsBoundaryError();
      }
      block.schemaLine = index;
      continue;
    }
    if (line === `${DIAGNOSTICS_KEY}:`) {
      if (block.listStart !== null) throw new LiskaLossDiagnosticsBoundaryError();
      block.listStart = index;
      const list = readDiagnosticList(lines, index);
      block.codes = list.codes;
      block.listEnd = list.end;
      index = list.end - 1;
      continue;
    }
    throw new LiskaLossDiagnosticsBoundaryError();
  }
  if ((block.schemaLine === null) !== (block.listStart === null)) {
    throw new LiskaLossDiagnosticsBoundaryError();
  }
  // This is intentionally conservative: after masking the one exact block
  // Liska owns, any other literal/escaped/tagged/flow/folded mention of that
  // key family is ambiguous. Refuse append rather than create duplicate YAML
  // semantics that our deliberately narrow parser cannot safely preserve.
  assertNoUnownedKeyReferences(lines, block);
  return block;
}

/**
 * Union historical observations without changing unrelated frontmatter lines.
 * A set-equivalent block is returned verbatim rather than rewritten to sort it.
 */
export function mergeRawLiskaLossDiagnostics(
  rawFrontmatter: string,
  incoming: readonly LiskaLossDiagnosticCode[] | undefined
): { raw: string; changed: boolean } {
  const normalized = normalizeLiskaLossDiagnostics(incoming);
  const lines = rawFrontmatter.split('\n');
  if (lines[0] !== '---' || lines[lines.length - 1] !== '---' || rawFrontmatter.includes('\r')) {
    throw new LiskaLossDiagnosticsBoundaryError();
  }
  const block = readOwnedBlock(lines);
  const merged = mergeLiskaLossDiagnostics(block.codes, normalized);
  if (merged.length === block.codes.length) return { raw: rawFrontmatter, changed: false };
  const newList = [DIAGNOSTICS_KEY + ':', ...merged.map(code => `  - ${code}`)];
  if (block.listStart === null || block.listEnd === null) {
    lines.splice(lines.length - 1, 0, `${SCHEMA_KEY}: 1`, ...newList);
  } else {
    lines.splice(block.listStart, block.listEnd - block.listStart, ...newList);
  }
  return { raw: lines.join('\n'), changed: true };
}
