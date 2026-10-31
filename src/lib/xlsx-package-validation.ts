/** Bounded structural XLSX admission: metadata only, never cells/formulas; uninspected payload CRCs are not certified. */
export const XLSX_PACKAGE_HARD_LIMITS = Object.freeze({
  maxArchiveBytes: 64 * 1_048_576,
  maxEntries: 4096,
  maxCentralDirectoryBytes: 2 * 1_048_576,
  maxFilenameBytes: 1024,
  maxEntryExpandedBytes: 128 * 1_048_576,
  maxTotalExpandedBytes: 512 * 1_048_576,
  maxXmlBytes: 1_048_576,
  maxTotalXmlBytes: 8 * 1_048_576,
  maxCompressionRatio: 200,
  maxXmlNodes: 50_000,
  maxXmlDepth: 64,
  maxXmlAttributes: 64,
});

export type XlsxPackageLimits = { -readonly [K in keyof typeof XLSX_PACKAGE_HARD_LIMITS]: number };
export type XlsxPackageFailureCode =
  | 'invalid-input'
  | 'invalid-limits'
  | 'invalid-zip'
  | 'unsupported-zip'
  | 'unsafe-name'
  | 'duplicate-name'
  | 'resource-limit'
  | 'inflater-unavailable'
  | 'inflate-failed'
  | 'integrity-failed'
  | 'invalid-xml'
  | 'unsafe-xml'
  | 'invalid-package'
  | 'external-relationship'
  | 'macro-enabled';

export type XlsxPackageValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: XlsxPackageFailureCode };

/** Trusted inflater must consume all owned input, reject trailing data and yield bounded chunks; the consumer checks size/CRC. */
export type XlsxPackageInflater = (
  compressed: Uint8Array,
  maxExpandedBytes: number
) => AsyncIterable<Uint8Array>;

export interface XlsxPackageValidationOptions {
  /** Overrides can only lower hard limits. */
  limits?: Partial<XlsxPackageLimits>;
  inflateRaw?: XlsxPackageInflater;
}

class AdmissionError extends Error {
  constructor(readonly code: XlsxPackageFailureCode) {
    super(code);
  }
}
const failures = new WeakSet<AdmissionError>();
function fail(code: XlsxPackageFailureCode): never {
  const error = new AdmissionError(code);
  failures.add(error);
  throw error;
}
function knownFailure(error: unknown): error is AdmissionError {
  return error instanceof AdmissionError && failures.has(error);
}
function limitsFrom(overrides: Partial<XlsxPackageLimits> = {}): XlsxPackageLimits {
  const limits: XlsxPackageLimits = { ...XLSX_PACKAGE_HARD_LIMITS };
  if (!overrides || typeof overrides !== 'object') fail('invalid-limits');
  for (const key of Object.keys(overrides) as (keyof XlsxPackageLimits)[]) {
    const value = overrides[key];
    if (
      !Object.prototype.hasOwnProperty.call(limits, key) ||
      !Number.isSafeInteger(value) ||
      value! < 1 ||
      value! > limits[key]
    )
      fail('invalid-limits');
    limits[key] = value!;
  }
  return limits;
}

interface Entry {
  name: string;
  rawName: Uint8Array;
  version: number;
  flags: number;
  method: number;
  crc: number;
  compressed: number;
  expanded: number;
  offset: number;
  dataStart: number;
}
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
function decode(bytes: Uint8Array, code: 'unsafe-name' | 'invalid-xml'): string {
  try {
    return utf8.decode(bytes);
  } catch {
    fail(code);
  }
}
function partName(raw: Uint8Array, flags: number, limits: XlsxPackageLimits): string {
  if (!raw.length || raw.length > limits.maxFilenameBytes) fail('resource-limit');
  // Non-ASCII legacy encodings and URI aliases are intentionally outside this profile.
  if (!(flags & 0x800) && raw.some(byte => byte >= 128)) fail('unsafe-name');
  const name = decode(raw, 'unsafe-name');
  if (hasControl(name) || /[\\:%?#]/.test(name) || name.startsWith('/')) fail('unsafe-name');
  const parts = name.replace(/\/$/, '').split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) fail('unsafe-name');
  return name;
}
function key(name: string): string {
  return name.normalize('NFC').toUpperCase().toLowerCase().normalize('NFC').replace(/\/$/, '');
}
function hasControl(value: string): boolean {
  for (const char of value) {
    if (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) return true;
  }
  return false;
}
function extra(data: DataView, start: number, length: number): void {
  const end = start + length;
  const seen = new Set<number>();
  for (let cursor = start; cursor < end; ) {
    if (cursor + 4 > end) fail('invalid-zip');
    const id = data.getUint16(cursor, true);
    const size = data.getUint16(cursor + 2, true);
    if (id === 1 || id === 0x7075) fail('unsupported-zip');
    if (seen.has(id)) fail('invalid-zip');
    seen.add(id);
    cursor += 4 + size;
    if (cursor > end) fail('invalid-zip');
  }
}
function profile(version: number, flags: number, method: number): void {
  const allowed = 0x0808 | (method === 8 ? 6 : 0);
  if (version < 10 || version > 20 || (flags & ~allowed) !== 0 || (method !== 0 && method !== 8))
    fail('unsupported-zip');
  if ((method === 8 || flags & 8) && version < 20) fail('unsupported-zip');
}
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

function findEndRecord(data: DataView): number {
  if (data.byteLength < 22) fail('invalid-zip');
  let end = -1;
  for (
    let cursor = data.byteLength - 22;
    cursor >= Math.max(0, data.byteLength - 65557);
    cursor--
  ) {
    if (
      data.getUint32(cursor, true) === 0x06054b50 &&
      cursor + 22 + data.getUint16(cursor + 20, true) === data.byteLength
    ) {
      if (end !== -1) fail('invalid-zip');
      end = cursor;
    }
  }
  if (end === -1) fail('invalid-zip');
  return end;
}
function directoryBounds(data: DataView, limits: XlsxPackageLimits) {
  const end = findEndRecord(data);
  const count = data.getUint16(end + 10, true);
  const size = data.getUint32(end + 12, true);
  const start = data.getUint32(end + 16, true);
  if (
    data.getUint16(end + 4, true) !== 0 ||
    data.getUint16(end + 6, true) !== 0 ||
    count === 0xffff ||
    size === 0xffffffff ||
    start === 0xffffffff ||
    (end >= 20 && data.getUint32(end - 20, true) === 0x07064b50)
  )
    fail('unsupported-zip');
  if (!count || count !== data.getUint16(end + 8, true) || start + size !== end)
    fail('invalid-zip');
  if (count > limits.maxEntries || size > limits.maxCentralDirectoryBytes) fail('resource-limit');
  return { count, start, end };
}
function fileKind(entry: Entry, attributes: number): void {
  const kind = (attributes >>> 16) & 0xf000;
  const directory = entry.name.endsWith('/');
  if ((kind && ![0x4000, 0x8000].includes(kind)) || attributes & 8) fail('unsupported-zip');
  if (((kind === 0x4000 || attributes & 16) && !directory) || (directory && kind === 0x8000))
    fail('invalid-zip');
  if (directory && (entry.expanded || entry.compressed || entry.crc)) fail('invalid-zip');
  if (entry.method === 0 && entry.compressed !== entry.expanded) fail('invalid-zip');
}
function centralEntry(
  bytes: Uint8Array,
  data: DataView,
  cursor: number,
  end: number,
  limits: XlsxPackageLimits
) {
  if (cursor + 46 > end || data.getUint32(cursor, true) !== 0x02014b50) fail('invalid-zip');
  const nameLength = data.getUint16(cursor + 28, true);
  const extraLength = data.getUint16(cursor + 30, true);
  const next = cursor + 46 + nameLength + extraLength + data.getUint16(cursor + 32, true);
  if (next > end) fail('invalid-zip');
  const flags = data.getUint16(cursor + 8, true);
  const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
  const entry: Entry = {
    name: partName(rawName, flags, limits),
    rawName,
    version: data.getUint16(cursor + 6, true),
    flags,
    method: data.getUint16(cursor + 10, true),
    crc: data.getUint32(cursor + 16, true),
    compressed: data.getUint32(cursor + 20, true),
    expanded: data.getUint32(cursor + 24, true),
    offset: data.getUint32(cursor + 42, true),
    dataStart: 0,
  };
  profile(entry.version, flags, entry.method);
  if (
    data.getUint16(cursor + 34, true) !== 0 ||
    [entry.compressed, entry.expanded, entry.offset].includes(0xffffffff)
  )
    fail('unsupported-zip');
  fileKind(entry, data.getUint32(cursor + 38, true));
  extra(data, cursor + 46 + nameLength, extraLength);
  return { entry, next };
}
function localSizes(data: DataView, entry: Entry, dataEnd: number, next: number): void {
  const values = [14, 18, 22].map(position => data.getUint32(entry.offset + position, true));
  const expected = [entry.crc, entry.compressed, entry.expanded];
  const matches = values.every((value, i) => value === expected[i]);
  if (!(entry.flags & 8)) {
    if (!matches || dataEnd !== next) fail('invalid-zip');
    return;
  }
  if (!matches && !values.every(value => value === 0)) fail('invalid-zip');
  const length = next - dataEnd;
  if (length !== 12 && length !== 16) fail('invalid-zip');
  const base = length === 16 ? 4 : 0;
  if (
    (base && data.getUint32(dataEnd, true) !== 0x08074b50) ||
    expected.some((value, i) => data.getUint32(dataEnd + base + 4 * i, true) !== value)
  )
    fail('invalid-zip');
}
function localEntry(bytes: Uint8Array, data: DataView, entry: Entry, next: number): void {
  const offset = entry.offset;
  if (offset + 30 > next || data.getUint32(offset, true) !== 0x04034b50) fail('invalid-zip');
  if (
    data.getUint16(offset + 4, true) !== entry.version ||
    data.getUint16(offset + 6, true) !== entry.flags ||
    data.getUint16(offset + 8, true) !== entry.method
  )
    fail('invalid-zip');
  const nameLength = data.getUint16(offset + 26, true);
  const extraLength = data.getUint16(offset + 28, true);
  entry.dataStart = offset + 30 + nameLength + extraLength;
  const dataEnd = entry.dataStart + entry.compressed;
  if (dataEnd > next) fail('invalid-zip');
  if (!sameBytes(entry.rawName, bytes.subarray(offset + 30, offset + 30 + nameLength)))
    fail('invalid-zip');
  extra(data, offset + 30 + nameLength, extraLength);
  localSizes(data, entry, dataEnd, next);
}
function parentNames(entries: Map<string, Entry>, names: Set<string>): void {
  for (const entry of entries.values()) {
    const parts = entry.name.split('/');
    for (let index = 1; index < parts.length; index++) {
      const parent = parts.slice(0, index).join('/');
      if (names.has(key(parent)) && !entries.has(`${parent}/`)) fail('duplicate-name');
    }
  }
}
function zipEntries(bytes: Uint8Array, limits: XlsxPackageLimits): Map<string, Entry> {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { start, end, count } = directoryBounds(data, limits);
  const entries = new Map<string, Entry>();
  const names = new Set<string>();
  let cursor = start;
  let totalExpanded = 0;
  for (let index = 0; index < count; index++) {
    const { entry, next } = centralEntry(bytes, data, cursor, end, limits);
    if (names.has(key(entry.name))) fail('duplicate-name');
    names.add(key(entry.name));
    entries.set(entry.name, entry);
    totalExpanded += entry.expanded;
    if (
      entry.expanded > limits.maxEntryExpandedBytes ||
      totalExpanded > limits.maxTotalExpandedBytes ||
      entry.expanded > entry.compressed * limits.maxCompressionRatio
    )
      fail('resource-limit');
    cursor = next;
  }
  if (cursor !== end) fail('invalid-zip');
  parentNames(entries, names);
  const ordered = [...entries.values()].sort((a, b) => a.offset - b.offset);
  if (ordered[0].offset !== 0) fail('invalid-zip');
  for (let index = 0; index < ordered.length; index++) {
    localEntry(bytes, data, ordered[index], ordered[index + 1]?.offset ?? start);
  }
  return entries;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
async function* nativeInflate(compressed: Uint8Array): AsyncGenerator<Uint8Array> {
  let transform: DecompressionStream;
  try {
    transform = new DecompressionStream('deflate-raw');
  } catch {
    fail('inflater-unavailable');
  }
  const input = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(new Uint8Array(compressed));
      controller.close();
    },
  });
  const reader = input.pipeThrough(transform).getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) return;
      yield next.value;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
async function metadataBytes(
  bytes: Uint8Array,
  entry: Entry,
  inflater: XlsxPackageInflater
): Promise<Uint8Array> {
  const compressed = new Uint8Array(
    bytes.subarray(entry.dataStart, entry.dataStart + entry.compressed)
  );
  const result = new Uint8Array(entry.expanded);
  if (entry.method === 0) result.set(compressed);
  else {
    let size = 0;
    try {
      for await (const chunk of inflater(compressed, entry.expanded)) {
        if (!(chunk instanceof Uint8Array)) fail('inflate-failed');
        if (!chunk.length || size + chunk.length > entry.expanded) fail('integrity-failed');
        result.set(chunk, size);
        size += chunk.length;
      }
    } catch (error) {
      if (knownFailure(error)) throw error;
      fail('inflate-failed');
    }
    if (size !== entry.expanded) fail('integrity-failed');
  }
  if (crc32(result) !== entry.crc) fail('integrity-failed');
  return result;
}

const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DOC_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const SHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const CONTENT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const WORKBOOK_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
const WORKSHEET_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';
interface XmlAttribute {
  name: string;
  ns: string;
  value: string;
}
interface XmlNode {
  name: string;
  ns: string;
  attributes: XmlAttribute[];
  children: XmlNode[];
  hasText: boolean;
}
function xmlCharacters(value: string): boolean {
  for (const char of value) {
    const cp = char.codePointAt(0)!;
    if (
      !(
        cp === 9 ||
        cp === 10 ||
        cp === 13 ||
        (cp >= 32 && cp <= 0xd7ff) ||
        (cp >= 0xe000 && cp <= 0xfffd) ||
        (cp >= 0x10000 && cp <= 0x10ffff)
      )
    )
      return false;
  }
  return true;
}
const XML_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};
function entityValue(entity: string): string {
  if (Object.prototype.hasOwnProperty.call(XML_ENTITIES, entity)) return XML_ENTITIES[entity];
  if (!/^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(entity)) fail('invalid-xml');
  const cp = entity.startsWith('#x')
    ? Number.parseInt(entity.slice(2), 16)
    : Number(entity.slice(1));
  if (!Number.isSafeInteger(cp) || cp > 0x10ffff || !xmlCharacters(String.fromCodePoint(cp)))
    fail('invalid-xml');
  return String.fromCodePoint(cp);
}
function entities(value: string): string {
  let result = '';
  let cursor = 0;
  while (cursor < value.length) {
    const start = value.indexOf('&', cursor);
    if (start === -1) return result + value.slice(cursor);
    const end = value.indexOf(';', start + 1);
    if (end === -1) fail('invalid-xml');
    result += value.slice(cursor, start) + entityValue(value.slice(start + 1, end));
    cursor = end + 1;
  }
  return result;
}
function qualified(name: string): [string, string] {
  const parts = name.split(':');
  if (parts.length > 2 || parts.some(part => !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(part)))
    fail('invalid-xml');
  return parts.length === 1 ? ['', parts[0]] : [parts[0], parts[1]];
}

interface XmlFrame {
  qname: string;
  node: XmlNode;
  namespaces: Map<string, string>;
}
function namespaceAttributes(
  attributes: Map<string, string>,
  namespaces: Map<string, string>
): XmlAttribute[] {
  const expanded = new Set<string>();
  const result: XmlAttribute[] = [];
  for (const [qattr, value] of attributes) {
    if (qattr === 'xmlns' || qattr.startsWith('xmlns:')) continue;
    const [prefix, name] = qualified(qattr);
    if (prefix && !namespaces.has(prefix)) fail('invalid-xml');
    const ns = prefix ? namespaces.get(prefix)! : '';
    const identifier = `${ns}\u0000${name}`;
    if (expanded.has(identifier)) fail('invalid-xml');
    expanded.add(identifier);
    result.push({ name, ns, value });
  }
  return result;
}
function namespaceScope(
  attributes: Map<string, string>,
  parent?: XmlFrame
): { namespaces: Map<string, string>; work: number } {
  const declarations = [...attributes].filter(
    ([name]) => name === 'xmlns' || name.startsWith('xmlns:')
  );
  const inherited = parent?.namespaces ?? new Map([['xml', XML_NS]]);
  if (declarations.length === 0) return { namespaces: inherited, work: 0 };
  const namespaces = new Map(inherited);
  for (const [name, value] of declarations) {
    const prefix = name === 'xmlns' ? '' : name.slice(6);
    if (
      prefix === 'xmlns' ||
      (prefix === 'xml' ? value !== XML_NS : value === XML_NS) ||
      value === 'http://www.w3.org/2000/xmlns/' ||
      (prefix && !value)
    )
      fail('invalid-xml');
    namespaces.set(prefix, value);
  }
  return { namespaces, work: inherited.size + declarations.length };
}
/** Namespace-aware XML 1.0, without DTDs, custom entities, processing instructions,
 * networking, DOM, or text retention. Unknown nodes still count against limits. */
class MetadataXmlReader {
  private cursor = 0;
  private count = 0;
  private namespaceWork = 0;
  private root?: XmlNode;
  private readonly stack: XmlFrame[] = [];
  constructor(
    private readonly text: string,
    private readonly limits: XlsxPackageLimits
  ) {}

  read(): XmlNode {
    while (this.cursor < this.text.length) {
      if (this.text[this.cursor] !== '<') this.textNode();
      else if (this.text.startsWith('<!--', this.cursor)) this.comment();
      else if (this.text.startsWith('<?', this.cursor)) this.declaration();
      else if (this.text.startsWith('<![CDATA[', this.cursor)) this.cdata();
      else if (this.text.startsWith('</', this.cursor)) this.endElement();
      else this.startElement();
    }
    if (!this.root || this.stack.length) fail('invalid-xml');
    return this.root;
  }
  private whitespace(): boolean {
    const start = this.cursor;
    while (/[\t\r\n ]/.test(this.text[this.cursor] ?? '') && this.cursor < this.text.length)
      this.cursor++;
    return this.cursor !== start;
  }
  private name(): string {
    const start = this.cursor;
    while (/[A-Za-z0-9_.:-]/.test(this.text[this.cursor] ?? '') && this.cursor < this.text.length)
      this.cursor++;
    const name = this.text.slice(start, this.cursor);
    qualified(name);
    return name;
  }
  private textNode(): void {
    const end = this.text.indexOf('<', this.cursor);
    const raw = this.text.slice(this.cursor, end === -1 ? this.text.length : end);
    if (raw.includes(']]>') || (!this.stack.length && /[^\t\r\n ]/.test(raw))) fail('invalid-xml');
    const value = entities(raw);
    if (this.stack.length && /[^\t\r\n ]/.test(value))
      this.stack[this.stack.length - 1].node.hasText = true;
    this.cursor += raw.length;
  }
  private comment(): void {
    const end = this.text.indexOf('-->', this.cursor + 4);
    if (
      end === -1 ||
      this.text.slice(this.cursor + 4, end).includes('--') ||
      this.text[end - 1] === '-'
    )
      fail('invalid-xml');
    this.cursor = end + 3;
  }
  private declaration(): void {
    const end = this.text.indexOf('?>', this.cursor + 2);
    const declaration =
      /^xml[\t\r\n ]+version[\t\r\n ]*=[\t\r\n ]*(['"])1\.0\1(?:[\t\r\n ]+encoding[\t\r\n ]*=[\t\r\n ]*(['"])[Uu][Tt][Ff]-8\2)?(?:[\t\r\n ]+standalone[\t\r\n ]*=[\t\r\n ]*(['"])(?:yes|no)\3)?[\t\r\n ]*$/;
    if (this.cursor !== 0 || end === -1 || !declaration.test(this.text.slice(2, end)))
      fail('invalid-xml');
    this.cursor = end + 2;
  }
  private cdata(): void {
    const end = this.text.indexOf(']]>', this.cursor + 9);
    if (!this.stack.length || end === -1) fail('invalid-xml');
    if (/[^\t\r\n ]/.test(this.text.slice(this.cursor + 9, end)))
      this.stack[this.stack.length - 1].node.hasText = true;
    this.cursor = end + 3;
  }
  private endElement(): void {
    this.cursor += 2;
    const name = this.name();
    this.whitespace();
    if (this.text[this.cursor++] !== '>' || this.stack.pop()?.qname !== name) fail('invalid-xml');
  }
  private attributes(): Map<string, string> {
    const attributes = new Map<string, string>();
    while (true) {
      const separated = this.whitespace();
      if (this.text[this.cursor] === '/' || this.text[this.cursor] === '>') return attributes;
      if (!separated) fail('invalid-xml');
      const name = this.name();
      this.whitespace();
      if (this.text[this.cursor++] !== '=') fail('invalid-xml');
      this.whitespace();
      const quote = this.text[this.cursor++];
      if (quote !== '"' && quote !== "'") fail('invalid-xml');
      const end = this.text.indexOf(quote, this.cursor);
      if (end === -1 || this.text.slice(this.cursor, end).includes('<') || attributes.has(name))
        fail('invalid-xml');
      attributes.set(name, entities(this.text.slice(this.cursor, end).replace(/[\t\r\n]/g, ' ')));
      if (attributes.size > this.limits.maxXmlAttributes) fail('resource-limit');
      this.cursor = end + 1;
    }
  }
  private startElement(): void {
    this.cursor++;
    const qname = this.name();
    const attributes = this.attributes();
    const parent = this.stack[this.stack.length - 1];
    const scope = namespaceScope(attributes, parent);
    if (scope.work > this.limits.maxXmlNodes - this.namespaceWork) fail('resource-limit');
    this.namespaceWork += scope.work;
    const { namespaces } = scope;
    const [prefix, name] = qualified(qname);
    if (prefix === 'xmlns' || (prefix && !namespaces.has(prefix))) fail('invalid-xml');
    const node: XmlNode = {
      name,
      ns: namespaces.get(prefix) ?? '',
      attributes: namespaceAttributes(attributes, namespaces),
      children: [],
      hasText: false,
    };
    if (++this.count > this.limits.maxXmlNodes || this.stack.length + 1 > this.limits.maxXmlDepth)
      fail('resource-limit');
    if (parent) parent.node.children.push(node);
    else {
      if (this.root) fail('invalid-xml');
      this.root = node;
    }
    const closed = this.text[this.cursor] === '/';
    if (closed) this.cursor++;
    if (this.text[this.cursor++] !== '>') fail('invalid-xml');
    if (!closed) this.stack.push({ qname, node, namespaces });
  }
}
function parseXml(bytes: Uint8Array, limits: XlsxPackageLimits): XmlNode {
  const text = decode(bytes, 'invalid-xml')
    .replace(/^\ufeff/, '')
    .replace(/\r\n?/g, '\n');
  if (/<\s*!\s*(?:DOCTYPE|ENTITY)\b/i.test(text)) fail('unsafe-xml');
  if (!xmlCharacters(text)) fail('invalid-xml');
  return new MetadataXmlReader(text, limits).read();
}

function attr(node: XmlNode, name: string, ns = ''): string {
  return (
    node.attributes.find(attribute => attribute.name === name && attribute.ns === ns)?.value ?? ''
  );
}
function targetPart(base: string, target: string): string {
  if (!target || hasControl(target) || /[ \\:%?#]/.test(target) || target.startsWith('//'))
    fail('invalid-package');
  const parts = target.startsWith('/') ? [] : base.split('/').slice(0, -1);
  for (const segment of target.replace(/^\//, '').split('/')) {
    if (!segment || segment === '.') fail('invalid-package');
    if (segment === '..') {
      if (!parts.length) fail('invalid-package');
      parts.pop();
    } else parts.push(segment);
  }
  return parts.join('/');
}
interface Relationship {
  id: string;
  type: string;
  target: string;
}
function relationshipBase(name: string): string {
  if (name === '_rels/.rels') return '';
  const match = /^(?:(.*\/))?_rels\/([^/]+)\.rels$/.exec(name);
  if (!match) fail('invalid-package');
  return `${match[1] ?? ''}${match[2]}`;
}
function relationships(root: XmlNode, base: string, entries: Map<string, Entry>): Relationship[] {
  if (root.name !== 'Relationships' || root.ns !== REL_NS || root.hasText) fail('invalid-package');
  const ids = new Set<string>();
  const targets = new Set<string>();
  return root.children.map(node => {
    if (node.name !== 'Relationship' || node.ns !== REL_NS || node.children.length || node.hasText)
      fail('invalid-package');
    const id = attr(node, 'Id');
    const type = attr(node, 'Type');
    const mode = attr(node, 'TargetMode');
    if (mode && mode !== 'Internal') fail('external-relationship');
    if (/vbaproject|vbadata|macro(?:enabled|sheet)/i.test(type)) fail('macro-enabled');
    if (!id || /\s/.test(id) || !type || ids.has(id)) fail('invalid-package');
    const target = targetPart(base, attr(node, 'Target'));
    if (targets.has(key(target)) || !entries.has(target) || entries.get(target)!.name.endsWith('/'))
      fail('invalid-package');
    ids.add(id);
    targets.add(key(target));
    return { id, type, target };
  });
}
function contentTypes(root: XmlNode, entries: Map<string, Entry>): (part: string) => string {
  if (root.name !== 'Types' || root.ns !== CONTENT_NS || root.hasText) fail('invalid-package');
  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();
  const overrideKeys = new Set<string>();
  for (const node of root.children) {
    const type = contentTypeNode(node);
    if (node.name === 'Default') {
      const extension = attr(node, 'Extension').toLowerCase();
      if (!/^[a-z0-9]+$/.test(extension) || defaults.has(extension)) fail('invalid-package');
      defaults.set(extension, type);
    } else if (node.name === 'Override') {
      const raw = attr(node, 'PartName');
      if (!raw.startsWith('/')) fail('invalid-package');
      const part = targetPart('', raw);
      if (raw !== `/${part}` || overrideKeys.has(key(part)) || !entries.has(part))
        fail('invalid-package');
      overrideKeys.add(key(part));
      overrides.set(part, type);
    } else fail('invalid-package');
  }
  return part => overrides.get(part) ?? defaults.get(part.split('.').pop()!.toLowerCase()) ?? '';
}
function contentTypeNode(node: XmlNode): string {
  if (node.ns !== CONTENT_NS || node.children.length || node.hasText) fail('invalid-package');
  const type = attr(node, 'ContentType');
  if (/macro(?:enabled|sheet)|vbaproject|vbadata/i.test(type)) fail('macro-enabled');
  if (!/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(type)) fail('invalid-package');
  return type;
}
function metadataEntries(entries: Map<string, Entry>, limits: XlsxPackageLimits): Entry[] {
  for (const name of entries.keys()) {
    if (/(?:^|\/)(?:vba(?:project|data)|macrosheets(?:\/|$))/i.test(name)) fail('macro-enabled');
  }
  const required = [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
  ];
  if (required.some(name => !entries.has(name))) fail('invalid-package');
  const selected = [...entries.values()].filter(
    entry => required.includes(entry.name) || /\.rels$/i.test(entry.name)
  );
  let total = 0;
  for (const entry of selected) {
    total += entry.expanded;
    if (entry.expanded > limits.maxXmlBytes || total > limits.maxTotalXmlBytes)
      fail('resource-limit');
  }
  return selected;
}
async function packageMetadata(
  bytes: Uint8Array,
  entries: Map<string, Entry>,
  limits: XlsxPackageLimits,
  inflater: XlsxPackageInflater
): Promise<Map<string, XmlNode>> {
  const xml = new Map<string, XmlNode>();
  for (const entry of metadataEntries(entries, limits)) {
    xml.set(entry.name, parseXml(await metadataBytes(bytes, entry, inflater), limits));
  }
  return xml;
}
function packageRelationships(
  xml: Map<string, XmlNode>,
  entries: Map<string, Entry>
): Map<string, Relationship[]> {
  const rels = new Map<string, Relationship[]>();
  for (const [name, root] of xml) {
    if (!/\.rels$/i.test(name)) continue;
    const base = relationshipBase(name);
    if (base && !entries.has(base)) fail('invalid-package');
    rels.set(name, relationships(root, base, entries));
  }
  const office = rels
    .get('_rels/.rels')!
    .filter(rel => rel.type === `${DOC_REL_NS}/officeDocument`);
  if (office.length !== 1 || office[0].target !== 'xl/workbook.xml') fail('invalid-package');
  return rels;
}
function referencedWorksheet(sheet: XmlNode, rels: Map<string, Relationship>): Relationship {
  const id = attr(sheet, 'id', DOC_REL_NS);
  const rel = rels.get(id);
  if (
    sheet.name !== 'sheet' ||
    sheet.ns !== SHEET_NS ||
    sheet.children.length ||
    sheet.hasText ||
    !id ||
    !rel
  )
    fail('invalid-package');
  if (
    rel.type !== `${DOC_REL_NS}/worksheet` ||
    !rel.target.startsWith('xl/') ||
    /\.rels$/i.test(rel.target)
  )
    fail('invalid-package');
  return rel;
}
function verifyWorkbook(
  workbook: XmlNode,
  rels: Relationship[],
  typeFor: (part: string) => string
): void {
  if (workbook.name !== 'workbook' || workbook.ns !== SHEET_NS) fail('invalid-package');
  if (typeFor('xl/workbook.xml') !== WORKBOOK_TYPE) fail('invalid-package');
  const groups = workbook.children.filter(node => node.name === 'sheets' && node.ns === SHEET_NS);
  if (groups.length !== 1 || !groups[0].children.length || groups[0].hasText)
    fail('invalid-package');
  const byId = new Map(rels.map(rel => [rel.id, rel]));
  const ids = new Set<string>();
  const targets = new Set<string>();
  for (const sheet of groups[0].children) {
    const rel = referencedWorksheet(sheet, byId);
    if (ids.has(rel.id) || targets.has(key(rel.target)) || typeFor(rel.target) !== WORKSHEET_TYPE)
      fail('invalid-package');
    ids.add(rel.id);
    targets.add(key(rel.target));
  }
}

/** Validate the exact in-memory package without changing it. Do not mutate input
 * until the promise settles. Failures intentionally contain no XML, filenames,
 * inflater messages, or other potentially private workbook content. */
export async function validateXlsxPackageBytes(
  bytes: Uint8Array,
  options: XlsxPackageValidationOptions = {}
): Promise<XlsxPackageValidationResult> {
  try {
    if (!(bytes instanceof Uint8Array) || !options || typeof options !== 'object')
      fail('invalid-input');
    const limits = limitsFrom(options.limits);
    if (options.inflateRaw !== undefined && typeof options.inflateRaw !== 'function')
      fail('invalid-input');
    if (bytes.length > limits.maxArchiveBytes) fail('resource-limit');
    const entries = zipEntries(bytes, limits);
    const xml = await packageMetadata(bytes, entries, limits, options.inflateRaw ?? nativeInflate);
    const typeFor = contentTypes(xml.get('[Content_Types].xml')!, entries);
    const rels = packageRelationships(xml, entries);
    verifyWorkbook(xml.get('xl/workbook.xml')!, rels.get('xl/_rels/workbook.xml.rels')!, typeFor);
    return { ok: true };
  } catch (error) {
    return { ok: false, code: knownFailure(error) ? error.code : 'invalid-input' };
  }
}
