// @vitest-environment node
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import {
  validateXlsxPackageBytes,
  XLSX_PACKAGE_HARD_LIMITS,
  type XlsxPackageFailureCode,
  type XlsxPackageInflater,
  type XlsxPackageValidationOptions,
} from '../../src/lib/xlsx-package-validation';

const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DOC = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const SHEET = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const WORKBOOK = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
const WORKSHEET = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';
const PRIVATE = 'PRIVATE_WORKBOOK_SENTINEL';
const types = `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${WORKBOOK}"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="${WORKSHEET}"/></Types>`;
const rootRels = `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${DOC}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
const workbook = `<workbook xmlns="${SHEET}" xmlns:r="${DOC}"><sheets><sheet name="${PRIVATE}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
const workbookRels = `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${DOC}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;

interface Spec {
  name: string;
  text: string;
  method?: number;
  flags?: number;
  version?: number;
  descriptor?: 'signed' | 'unsigned';
  matchingLocalDescriptor?: boolean;
  compressed?: Uint8Array;
  expanded?: number;
  crc?: number;
  extra?: Buffer;
  localExtra?: Buffer;
  attributes?: number;
}
interface Fixture {
  bytes: Buffer;
  central: number;
  eocd: number;
  records: { local: number; payload: number; central: number; descriptor: number }[];
}
function specs(): Spec[] {
  return [
    { name: '[Content_Types].xml', text: types },
    { name: '_rels/.rels', text: rootRels },
    { name: 'xl/workbook.xml', text: workbook },
    { name: 'xl/_rels/workbook.xml.rels', text: workbookRels },
    {
      name: 'xl/worksheets/sheet1.xml',
      text: `<worksheet xmlns="${SHEET}"><sheetData/></worksheet>`,
    },
  ];
}
// Independent fixture producer; no production ZIP writer or CRC helper is used.
function crc32(bytes: Uint8Array): number {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ -1) >>> 0;
}
function fixture(
  entries = specs(),
  options: { comment?: string; centralOrder?: number[] } = {}
): Fixture {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  const records: Fixture['records'] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const plain = Buffer.from(entry.text);
    const method = entry.method ?? 0;
    const compressed = Buffer.from(
      entry.compressed ?? (method === 8 ? deflateRawSync(plain) : plain)
    );
    const crc = entry.crc ?? crc32(plain);
    const expanded = entry.expanded ?? plain.length;
    const flags = entry.flags ?? (entry.descriptor ? 8 : 0);
    const localExtra = entry.localExtra ?? entry.extra ?? Buffer.alloc(0);
    const extra = entry.extra ?? Buffer.alloc(0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(entry.version ?? 20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    if (!entry.descriptor || entry.matchingLocalDescriptor) {
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(compressed.length, 18);
      local.writeUInt32LE(expanded, 22);
    }
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(localExtra.length, 28);
    const descriptor = Buffer.alloc(
      entry.descriptor === 'signed' ? 16 : entry.descriptor === 'unsigned' ? 12 : 0
    );
    if (descriptor.length) {
      const base = descriptor.length === 16 ? 4 : 0;
      if (base) descriptor.writeUInt32LE(0x08074b50);
      descriptor.writeUInt32LE(crc, base);
      descriptor.writeUInt32LE(compressed.length, base + 4);
      descriptor.writeUInt32LE(expanded, base + 8);
    }
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(entry.version ?? 20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(expanded, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(extra.length, 30);
    central.writeUInt32LE(entry.attributes ?? 0, 38);
    central.writeUInt32LE(offset, 42);
    const payload = offset + 30 + name.length + localExtra.length;
    records.push({ local: offset, payload, central: -1, descriptor: payload + compressed.length });
    locals.push(local, name, localExtra, compressed, descriptor);
    centrals.push(Buffer.concat([central, name, extra]));
    offset = payload + compressed.length + descriptor.length;
  }
  const start = offset;
  const ordered = (options.centralOrder ?? entries.map((_, index) => index)).map(index => {
    records[index].central = offset;
    offset += centrals[index].length;
    return centrals[index];
  });
  const comment = Buffer.from(options.comment ?? '');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(offset - start, 12);
  end.writeUInt32LE(start, 16);
  end.writeUInt16LE(comment.length, 20);
  return {
    bytes: Buffer.concat([...locals, ...ordered, end, comment]),
    central: start,
    eocd: offset,
    records,
  };
}
const inflate: XlsxPackageInflater = async function* (bytes, maxExpandedBytes) {
  // Installed Node declarations omit the documented info:true return shape.
  const output = inflateRawSync(bytes, {
    maxOutputLength: maxExpandedBytes,
    info: true,
  }) as unknown as {
    buffer: Buffer;
    engine: { bytesWritten: number };
  };
  if (output.engine.bytesWritten !== bytes.length) throw new Error(PRIVATE);
  // Small pieces exercise streaming accumulation independently of native streams.
  for (let offset = 0; offset < output.buffer.length; offset += 37)
    yield output.buffer.subarray(offset, offset + 37);
};
function validate(input: Fixture | Uint8Array, options: XlsxPackageValidationOptions = {}) {
  return validateXlsxPackageBytes(input instanceof Uint8Array ? input : input.bytes, {
    inflateRaw: inflate,
    ...options,
  });
}
async function rejects(
  input: Fixture | Uint8Array,
  code: XlsxPackageFailureCode,
  options?: XlsxPackageValidationOptions
) {
  expect(await validate(input, options)).toEqual({ ok: false, code });
}
function changed(part: number, text: string): Spec[] {
  const entries = specs();
  entries[part].text = text;
  return entries;
}

describe('XLSX package admission', () => {
  it('admits minimal stored metadata and preserves every original byte', async () => {
    const input = fixture();
    const original = Buffer.from(input.bytes);
    expect(await validate(input)).toEqual({ ok: true });
    expect(input.bytes).toEqual(original);
  });

  it('admits deflated packages with deterministic injected inflation', async () => {
    expect(await validate(fixture(specs().map(entry => ({ ...entry, method: 8 }))))).toEqual({
      ok: true,
    });
  });

  it('admits several distinct worksheet references and normal parent-relative part relationships', async () => {
    const entries = specs();
    entries[0].text = types.replace(
      '</Types>',
      `<Override PartName="/xl/worksheets/sheet2.xml" ContentType="${WORKSHEET}"/></Types>`
    );
    entries[2].text = workbook.replace(
      '</sheets>',
      '<sheet name="Second" sheetId="2" r:id="rId2"/></sheets>'
    );
    entries[3].text = workbookRels.replace(
      '</Relationships>',
      `<Relationship Id="rId2" Type="${DOC}/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`
    );
    entries.push(
      { name: 'xl/worksheets/sheet2.xml', text: '<worksheet/>' },
      {
        name: 'xl/worksheets/_rels/sheet1.xml.rels',
        text: `<Relationships xmlns="${REL}"><Relationship Id="related" Type="${DOC}/worksheet" Target="../worksheets/sheet2.xml"/></Relationships>`,
      }
    );
    entries.push(
      { name: 'custom.xml', text: '<custom/>' },
      {
        name: '_rels/custom.xml.rels',
        text: `<Relationships xmlns="${REL}"><Relationship Id="related" Type="${DOC}/related" Target="xl/workbook.xml"/></Relationships>`,
      }
    );
    expect(await validate(fixture(entries))).toEqual({ ok: true });
  });

  it('runs the real browser-compatible DecompressionStream path', async () => {
    expect(
      await validateXlsxPackageBytes(fixture(specs().map(entry => ({ ...entry, method: 8 }))).bytes)
    ).toEqual({ ok: true });
  });

  it.each(['signed', 'unsigned'] as const)(
    'admits authoritative central sizes with %s descriptors',
    async descriptor => {
      const entries = specs().map(entry => ({ ...entry, method: 8, descriptor }));
      expect(await validate(fixture(entries))).toEqual({ ok: true });
      expect(
        await validate(fixture(entries.map(entry => ({ ...entry, matchingLocalDescriptor: true }))))
      ).toEqual({ ok: true });
    }
  );

  it('accepts comments, directories, reordered central records, namespace prefixes and absolute OPC targets', async () => {
    const entries = changed(1, rootRels.replace('Target="xl/', 'Target="/xl/'));
    entries[2].text = workbook
      .replace('<workbook ', '<s:workbook ')
      .replace('xmlns=', 'xmlns:s=')
      .replace('<sheets>', '<s:sheets>')
      .replace('</sheets>', '</s:sheets>')
      .replace('<sheet ', '<s:sheet ')
      .replace('</workbook>', '</s:workbook>');
    entries.push({ name: 'xl/', text: '', attributes: 16 });
    expect(
      await validate(
        fixture(entries, { comment: 'ordinary comment', centralOrder: [5, 3, 2, 4, 0, 1] })
      )
    ).toEqual({ ok: true });
  });

  it('does not inflate or parse worksheet cells, formulas or unrelated payloads', async () => {
    const entries = specs().map(entry => ({ ...entry, method: 8 }));
    entries[4].text =
      'This is not worksheet XML and is deliberately never parsed =WEBSERVICE("private")';
    entries.push({ name: 'xl/media/picture.bin', text: 'not compressed', method: 8 });
    const spy = vi.fn(inflate);
    expect(await validate(fixture(entries), { inflateRaw: spy })).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it('never exposes a Buffer slice of caller input to an injected inflater', async () => {
    const input = fixture(specs().map(entry => ({ ...entry, method: 8 })));
    const original = Buffer.from(input.bytes);
    await rejects(input, 'integrity-failed', {
      inflateRaw: async function* (compressed, max) {
        compressed.fill(0);
        yield new Uint8Array(max);
      },
    });
    expect(input.bytes).toEqual(original);
  });

  it.each([
    ['EOCD signature', (input: Fixture) => input.bytes.writeUInt32LE(0, input.eocd)],
    ['EOCD count', (input: Fixture) => input.bytes.writeUInt16LE(4, input.eocd + 8)],
    ['central size', (input: Fixture) => input.bytes.writeUInt32LE(10, input.eocd + 12)],
    ['central signature', (input: Fixture) => input.bytes.writeUInt32LE(0, input.central)],
    [
      'central name bounds',
      (input: Fixture) => input.bytes.writeUInt16LE(65535, input.central + 28),
    ],
    ['local signature', (input: Fixture) => input.bytes.writeUInt32LE(0, 0)],
    [
      'local name',
      (input: Fixture) => {
        input.bytes[input.records[0].local + 30] ^= 1;
      },
    ],
    ['local name length', (input: Fixture) => input.bytes.writeUInt16LE(65535, 26)],
    ['local flags', (input: Fixture) => input.bytes.writeUInt16LE(8, 6)],
    ['local CRC', (input: Fixture) => input.bytes.writeUInt32LE(0, 14)],
    ['local extra bounds', (input: Fixture) => input.bytes.writeUInt16LE(65535, 28)],
    [
      'overlapping local offsets',
      (input: Fixture) => input.bytes.writeUInt32LE(0, input.records[1].central + 42),
    ],
    [
      'out of bounds local offsets',
      (input: Fixture) => input.bytes.writeUInt32LE(0xfffffffe, input.central + 42),
    ],
  ] as const)('rejects corrupt %s', async (_name, corrupt) => {
    const input = fixture();
    corrupt(input);
    await rejects(input, 'invalid-zip');
  });

  it('rejects truncation, appended bytes, empty archives and arbitrary bytes', async () => {
    const input = fixture();
    await rejects(input.bytes.subarray(0, -1), 'invalid-zip');
    await rejects(Buffer.concat([input.bytes, Buffer.from('extra')]), 'invalid-zip');
    await rejects(fixture([]), 'invalid-zip');
    await rejects(Buffer.from('PK'), 'invalid-zip');
  });

  it('rejects corrupt descriptors and inconsistent nonzero local descriptor fields', async () => {
    const input = fixture(specs().map(entry => ({ ...entry, descriptor: 'signed' })));
    input.bytes[input.records[0].descriptor + 4] ^= 1;
    await rejects(input, 'invalid-zip');
    const other = fixture(specs().map(entry => ({ ...entry, descriptor: 'unsigned' })));
    other.bytes.writeUInt32LE(1, 14);
    await rejects(other, 'invalid-zip');
  });

  it.each([
    '../evil.xml',
    '/absolute.xml',
    'C:/evil.xml',
    'xl\\evil.xml',
    'xl/./evil.xml',
    'xl//evil.xml',
    'xl/evil\0.xml',
    'xl/%2e%2e/evil.xml',
    'xl/evil?x.xml',
  ])('rejects unsafe part name %j', async name => {
    await rejects(fixture([...specs(), { name, text: '' }]), 'unsafe-name');
  });

  it.each(['xl/workbook.xml', 'XL/WORKBOOK.XML'])(
    'rejects duplicate or case-colliding names %s',
    async name => {
      await rejects(fixture([...specs(), { name, text: '' }]), 'duplicate-name');
    }
  );

  it('rejects file-directory aliases and Unicode-normalized name collisions', async () => {
    await rejects(fixture([...specs(), { name: 'xl', text: '' }]), 'duplicate-name');
    await rejects(
      fixture([...specs(), { name: 'a/', text: '' }, { name: 'A', text: '' }]),
      'duplicate-name'
    );
    await rejects(
      fixture([
        ...specs(),
        { name: 'é.xml', text: '', flags: 0x800 },
        { name: 'e\u0301.xml', text: '', flags: 0x800 },
      ]),
      'duplicate-name'
    );
    await rejects(
      fixture([
        ...specs(),
        { name: 'ß.xml', text: '', flags: 0x800 },
        { name: 'SS.xml', text: '', flags: 0x800 },
      ]),
      'duplicate-name'
    );
  });

  it.each([
    ['encrypted', { flags: 1 }],
    ['strong encryption', { flags: 0x40 }],
    ['unsupported method', { method: 12 }],
    ['ZIP64 version', { version: 45 }],
    ['invalid ZIP version', { version: 0 }],
    ['inconsistent ZIP version', { version: 10, method: 8 }],
    ['ZIP64 extra', { extra: Buffer.from([1, 0, 0, 0]) }],
    ['Unicode path override', { extra: Buffer.from([0x75, 0x70, 0, 0]) }],
    ['symlink', { attributes: 0xa0000000 }],
  ] as const)('rejects %s', async (_name, options) => {
    const entries = specs();
    entries[0] = { ...entries[0], ...options };
    await rejects(fixture(entries), 'unsupported-zip');
  });

  it.each([
    [8, 'u16', 0xffff],
    [10, 'u16', 0xffff],
    [12, 'u32', 0xffffffff],
    [16, 'u32', 0xffffffff],
    [4, 'u16', 1],
  ] as const)('rejects ZIP64 or split EOCD field %i', async (position, kind, value) => {
    const input = fixture();
    if (position === 8) input.bytes.writeUInt16LE(0xffff, input.eocd + 10);
    if (kind === 'u16') input.bytes.writeUInt16LE(value, input.eocd + position);
    else input.bytes.writeUInt32LE(value, input.eocd + position);
    await rejects(input, 'unsupported-zip');
  });

  it('rejects central ZIP64 sizes and offsets and malformed extra fields', async () => {
    for (const position of [20, 24, 42]) {
      const input = fixture();
      input.bytes.writeUInt32LE(0xffffffff, input.central + position);
      await rejects(input, 'unsupported-zip');
    }
    await rejects(
      fixture(specs().map(entry => ({ ...entry, extra: Buffer.from([2, 0, 4, 0]) }))),
      'invalid-zip'
    );
    await rejects(
      fixture(specs().map(entry => ({ ...entry, localExtra: Buffer.from([2, 0, 4, 0]) }))),
      'invalid-zip'
    );
    await rejects(
      fixture(specs().map(entry => ({ ...entry, localExtra: Buffer.from([1, 0, 0, 0]) }))),
      'unsupported-zip'
    );
    await rejects(
      fixture(specs().map(entry => ({ ...entry, extra: Buffer.from([2, 0, 0, 0, 2, 0, 0, 0]) }))),
      'invalid-zip'
    );
  });

  it('rejects unsafe or invalid filename encodings without silently dropping BOMs', async () => {
    await rejects(fixture([...specs(), { name: 'é.xml', text: '' }]), 'unsafe-name');
    const input = fixture([...specs(), { name: 'x.xml', text: '', flags: 0x800 }]);
    input.bytes[input.records[5].local + 30] = 0xff;
    input.bytes[input.records[5].central + 46] = 0xff;
    await rejects(input, 'unsafe-name');
    const entries = specs();
    entries[0].name = `\ufeff${entries[0].name}`;
    entries[0].flags = 0x800;
    await rejects(fixture(entries), 'invalid-package');
  });

  it('checks limits before invoking an inflater', async () => {
    const spy = vi.fn(inflate);
    const input = fixture(specs().map(entry => ({ ...entry, method: 8 })));
    const cases: XlsxPackageValidationOptions['limits'][] = [
      { maxArchiveBytes: input.bytes.length - 1 },
      { maxEntries: 4 },
      { maxCentralDirectoryBytes: 10 },
      { maxFilenameBytes: 4 },
      { maxEntryExpandedBytes: 20 },
      { maxTotalExpandedBytes: 20 },
      { maxXmlBytes: 20 },
      { maxTotalXmlBytes: 20 },
      { maxCompressionRatio: 1 },
    ];
    for (const limits of cases) await rejects(input, 'resource-limit', { limits, inflateRaw: spy });
    expect(spy).not.toHaveBeenCalled();
    expect(XLSX_PACKAGE_HARD_LIMITS.maxArchiveBytes).toBe(64 * 1024 * 1024);
  });

  it('rejects a declared compression bomb even in an uninspected worksheet', async () => {
    const entries = specs();
    entries[4] = { ...entries[4], method: 8, compressed: Buffer.from([3, 0]), expanded: 100_000 };
    await rejects(fixture(entries), 'resource-limit');
  });

  it('rejects CRC errors and wrong expanded sizes in inspected metadata', async () => {
    const input = fixture();
    input.bytes[input.records[0].payload + 10] ^= 1;
    await rejects(input, 'integrity-failed');
    const entries = specs();
    entries[0] = { ...entries[0], method: 8, expanded: Buffer.byteLength(entries[0].text) + 1 };
    await rejects(fixture(entries), 'integrity-failed');
    await rejects(fixture(specs().map(entry => ({ ...entry, method: 8 }))), 'integrity-failed', {
      inflateRaw: async function* () {
        yield new Uint8Array(1);
      },
    });
  });

  it('bounds injected expansion, closes the iterator and sanitizes inflater errors', async () => {
    const input = fixture(specs().map(entry => ({ ...entry, method: 8 })));
    let closed = false;
    await rejects(input, 'integrity-failed', {
      inflateRaw: async function* (_bytes, max) {
        try {
          yield new Uint8Array(max + 1);
        } finally {
          closed = true;
        }
      },
    });
    expect(closed).toBe(true);
    const failure = await validate(input, {
      inflateRaw: function () {
        throw new Error(PRIVATE);
      },
    });
    expect(failure).toEqual({ ok: false, code: 'inflate-failed' });
    expect(JSON.stringify(failure)).not.toContain(PRIVATE);
    await rejects(input, 'inflate-failed', {
      inflateRaw: async function* () {
        yield 'not bytes' as unknown as Uint8Array;
      },
    });
    await rejects(input, 'integrity-failed', {
      inflateRaw: async function* () {
        yield new Uint8Array(0);
      },
    });
  });

  it('rejects truncated, trailing and corrupt deflate streams', async () => {
    for (const kind of ['truncated', 'trailing', 'corrupt']) {
      const entries = specs();
      const compressed = deflateRawSync(Buffer.from(entries[0].text));
      entries[0] = {
        ...entries[0],
        method: 8,
        compressed:
          kind === 'truncated'
            ? compressed.subarray(0, -2)
            : kind === 'trailing'
              ? Buffer.concat([compressed, Buffer.from('trailing')])
              : Buffer.from('broken'),
      };
      await rejects(fixture(entries), 'inflate-failed');
    }
  });

  it('fails closed when the native inflater is unavailable', async () => {
    vi.stubGlobal('DecompressionStream', undefined);
    try {
      const input = fixture(specs().map(entry => ({ ...entry, method: 8 })));
      expect(await validateXlsxPackageBytes(input.bytes)).toEqual({
        ok: false,
        code: 'inflater-unavailable',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects corrupt or trailing raw DEFLATE using the actual native stream', async () => {
    for (const append of [false, true]) {
      const entries = specs();
      entries[0] = {
        ...entries[0],
        method: 8,
        compressed: append
          ? Buffer.concat([deflateRawSync(Buffer.from(types)), Buffer.from('trailing')])
          : Buffer.from('broken'),
      };
      expect(await validateXlsxPackageBytes(fixture(entries).bytes)).toEqual({
        ok: false,
        code: 'inflate-failed',
      });
    }
  });

  it.each([
    '<broken>',
    '<a/><b/>',
    '<a><b></a>',
    '<a x="1" x="2"/>',
    '<a x="&unknown;"/>',
    '<a>&amp</a>',
    '<a>&#0;</a>',
    '<a>&#x110000;</a>',
    '<a>\0</a>',
    '<a xmlns:p="urn:x" xmlns:q="urn:x" p:x="1" q:x="2"/>',
    '<unbound:Types/>',
    '<a/ trailing>',
    '<!-- bad ---><a/>',
    '\u00a0<a/>',
    '<?XML version="1.0"?><a/>',
    '<?xml version="1.0" encoding="UTF-16"?><a/>',
    '<!-- broken -- comment --><a/>',
    '<?instruction private?><a/>',
  ])('rejects malformed metadata XML %j', async text => {
    await rejects(fixture(changed(0, text)), 'invalid-xml');
  });

  it.each([
    '<!DOCTYPE Types SYSTEM "https://example.invalid/private"><Types/>',
    '<!DOCTYPE Types [<!ENTITY xxe SYSTEM "file:///private">]><Types>&xxe;</Types>',
    '<!ENTITY x "private"><Types/>',
  ])('rejects DTD/entity declarations without any entity expansion', async text => {
    await rejects(fixture(changed(0, text)), 'unsafe-xml');
  });

  it('admits XML declarations, BOM, comments and harmless predefined/numeric entities', async () => {
    const entries = specs();
    entries[0].text = `\ufeff<?xml version="1.0" encoding="UTF-8" standalone="yes"?><!-- metadata -->${types}`;
    entries[2].text = workbook.replace(PRIVATE, 'A &amp; B &lt; C &#x2665; &#65;');
    expect(await validate(fixture(entries))).toEqual({ ok: true });
  });

  it('enforces XML depth, node and attribute limits', async () => {
    await rejects(fixture(), 'resource-limit', { limits: { maxXmlDepth: 1 } });
    await rejects(fixture(), 'resource-limit', { limits: { maxXmlNodes: 2 } });
    await rejects(fixture(), 'resource-limit', { limits: { maxXmlAttributes: 1 } });
  });

  it('reuses inherited namespace scope across a large namespace-free leaf run', async () => {
    const entries = changed(
      2,
      workbook.replace(
        '</workbook>',
        `<a xmlns:p="urn:bounded">${'<b/>'.repeat(49_000)}</a></workbook>`
      )
    );
    expect(await validate(fixture(entries))).toEqual({ ok: true });
  }, 2_000);

  it('bounds aggregate namespace cloning work before parsing the remaining metadata tree', async () => {
    const levels = Array.from({ length: 60 }, (_, level) => {
      const declarations = Array.from(
        { length: 64 },
        (_, index) => `xmlns:p${level}_${index}="urn:${level}:${index}"`
      ).join(' ');
      return `<a ${declarations}>`;
    }).join('');
    const entries = changed(
      2,
      workbook.replace(
        '</workbook>',
        `${levels}${'<b/>'.repeat(49_000)}${'</a>'.repeat(60)}</workbook>`
      )
    );
    await rejects(fixture(entries), 'resource-limit');
  });

  it('rejects a long run of unterminated entity openers without quadratic rescanning', async () => {
    await rejects(
      fixture(changed(0, `<Types xmlns="${CT}">${'&'.repeat(100_000)}</Types>`)),
      'invalid-xml'
    );
  });

  it.each([0, 1, 2, 3, 4])('requires package part %i', async index => {
    await rejects(fixture(specs().filter((_, i) => i !== index)), 'invalid-package');
  });

  it.each([
    rootRels.replace('officeDocument', 'notOfficeDocument'),
    rootRels.replace('Target="xl/workbook.xml"', 'Target="xl/worksheets/sheet1.xml"'),
    rootRels.replace('Target="xl/workbook.xml"', 'Target="XL/workbook.xml"'),
    rootRels.replace('Target="xl/workbook.xml"', 'Target="../xl/workbook.xml"'),
    rootRels.replace('Target="xl/workbook.xml"', 'Target="xl/%77orkbook.xml"'),
  ])('requires an unambiguous root officeDocument relationship', async text => {
    await rejects(fixture(changed(1, text)), 'invalid-package');
  });

  it('rejects external relationships in any .rels, not only the workbook', async () => {
    for (const mode of ['External', 'external']) {
      const text = rootRels.replace(
        'Target="xl/workbook.xml"',
        `Target="https://example.invalid/private" TargetMode="${mode}"`
      );
      await rejects(fixture(changed(1, text)), 'external-relationship');
    }
    await rejects(
      fixture([
        ...specs(),
        {
          name: 'xl/worksheets/_rels/sheet1.xml.rels',
          text: `<Relationships xmlns="${REL}"><Relationship Id="hyperlink" Type="${DOC}/hyperlink" Target="https://example.invalid/private" TargetMode="External"/></Relationships>`,
        },
      ]),
      'external-relationship'
    );
  });

  it('rejects duplicate relationship IDs, duplicate resolved targets and orphan .rels', async () => {
    for (const duplicate of [
      `<Relationship Id="rId1" Type="${DOC}/styles" Target="worksheets/sheet1.xml"/>`,
      `<Relationship Id="rId2" Type="${DOC}/worksheet" Target="/xl/worksheets/sheet1.xml"/>`,
    ]) {
      await rejects(
        fixture(
          changed(3, workbookRels.replace('</Relationships>', `${duplicate}</Relationships>`))
        ),
        'invalid-package'
      );
    }
    await rejects(
      fixture([
        ...specs(),
        { name: 'xl/_rels/missing.xml.rels', text: `<Relationships xmlns="${REL}"/>` },
      ]),
      'invalid-package'
    );
  });

  it('checks every relationship metadata XML and rejects unexpected metadata text', async () => {
    await rejects(
      fixture([...specs(), { name: 'xl/worksheets/_rels/sheet1.xml.rels', text: '<broken>' }]),
      'invalid-xml'
    );
    await rejects(
      fixture([
        ...specs(),
        {
          name: 'xl/worksheets/_rels/sheet1.xml.rels',
          text: '<!DOCTYPE Relationships><Relationships/>',
        },
      ]),
      'unsafe-xml'
    );
    await rejects(
      fixture(changed(0, types.replace('</Types>', `${PRIVATE}</Types>`))),
      'invalid-package'
    );
    await rejects(
      fixture(
        changed(1, rootRels.replace('</Relationships>', '<![CDATA[unexpected]]></Relationships>'))
      ),
      'invalid-package'
    );
    await rejects(
      fixture(changed(3, workbookRels.replace('/>', '>unexpected</Relationship>'))),
      'invalid-package'
    );
  });

  it('rejects multiple officeDocument relationships even with distinct IDs/targets', async () => {
    const extra = `<Relationship Id="rId2" Type="${DOC}/officeDocument" Target="xl/worksheets/sheet1.xml"/>`;
    await rejects(
      fixture(changed(1, rootRels.replace('</Relationships>', `${extra}</Relationships>`))),
      'invalid-package'
    );
  });

  it.each([
    workbook.replace('r:id="rId1"', 'r:id="missing"'),
    workbook.replace('r:id="rId1"', 'id="rId1"'),
    workbook.replace(/<sheets>.*<\/sheets>/, '<sheets/>'),
    workbook.replace('</sheets>', `<sheet name="Another" sheetId="2" r:id="rId1"/></sheets>`),
    workbook.replace('</workbook>', '<sheets/></workbook>'),
  ])('rejects workbook sheet/relationship mismatches', async text => {
    await rejects(fixture(changed(2, text)), 'invalid-package');
  });

  it('requires worksheet relationship types, content types, existing targets and xl containment', async () => {
    await rejects(
      fixture(changed(3, workbookRels.replace('/worksheet"', '/styles"'))),
      'invalid-package'
    );
    await rejects(
      fixture(changed(3, workbookRels.replace('sheet1.xml', 'missing.xml'))),
      'invalid-package'
    );
    await rejects(
      fixture(changed(0, types.replace(WORKSHEET, 'application/xml'))),
      'invalid-package'
    );
    await rejects(
      fixture(changed(0, types.replace(WORKBOOK, 'application/xml'))),
      'invalid-package'
    );
    const entries = specs();
    entries[4].name = 'outside.xml';
    entries[0].text = types.replace('/xl/worksheets/sheet1.xml', '/outside.xml');
    entries[3].text = workbookRels.replace('worksheets/sheet1.xml', '../outside.xml');
    await rejects(fixture(entries), 'invalid-package');
  });

  it('rejects ambiguous content type overrides/defaults', async () => {
    for (const duplicate of [
      `<Default Extension="XML" ContentType="application/xml"/>`,
      `<Override PartName="/xl/workbook.xml" ContentType="${WORKBOOK}"/>`,
    ])
      await rejects(
        fixture(changed(0, types.replace('</Types>', `${duplicate}</Types>`))),
        'invalid-package'
      );
  });

  it('rejects macros advertised by content types, relationships or hidden VBA parts', async () => {
    await rejects(
      fixture(
        changed(0, types.replace(WORKBOOK, 'application/vnd.ms-excel.sheet.macroEnabled.main+xml'))
      ),
      'macro-enabled'
    );
    await rejects(
      fixture(changed(3, workbookRels.replace('/worksheet', '/vbaProject'))),
      'macro-enabled'
    );
    await rejects(
      fixture([...specs(), { name: 'xl/vbaProject.bin', text: 'private' }]),
      'macro-enabled'
    );
    await rejects(
      fixture(changed(0, types.replace(WORKSHEET, 'application/vnd.ms-excel.macrosheet+xml'))),
      'macro-enabled'
    );
    await rejects(
      fixture(changed(3, workbookRels.replace('/worksheet', '/xlMacrosheet'))),
      'macro-enabled'
    );
    await rejects(
      fixture([...specs(), { name: 'xl/vbaProjectSignature.bin', text: 'private' }]),
      'macro-enabled'
    );
    await rejects(
      fixture([...specs(), { name: 'xl/macrosheets/sheet.xml', text: 'private' }]),
      'macro-enabled'
    );
  });

  it('rejects invalid inputs and invalid or higher-than-hard limit overrides', async () => {
    expect(await validateXlsxPackageBytes(null as unknown as Uint8Array)).toEqual({
      ok: false,
      code: 'invalid-input',
    });
    await rejects(fixture(), 'invalid-limits', { limits: { maxXmlBytes: 0 } });
    await rejects(fixture(), 'invalid-limits', { limits: { maxEntries: 4097 } });
    await rejects(fixture(), 'invalid-limits', {
      limits: { unknown: 1 } as XlsxPackageValidationOptions['limits'],
    });
    await rejects(fixture(), 'invalid-input', {
      inflateRaw: true as unknown as XlsxPackageInflater,
    });
  });
});
