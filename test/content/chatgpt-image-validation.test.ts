import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { validateChatGptImageBytes } from '../../src/content/capture/chatgpt-image-validation';
import { validChatGptJpegBytes, validChatGptPngBytes } from '../fixtures/chatgpt-image-bytes';

function join(...parts: (Uint8Array | number[])[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function u32(value: number): number[] {
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

// Independent bit-at-a-time CRC oracle, rather than the implementation's table.
function pngChunk(type: string, data: Uint8Array | number[] = []): Uint8Array {
  const content = join(
    [...type].map(letter => letter.charCodeAt(0)),
    data
  );
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return join(u32(data.length), content, u32((crc ^ 0xffffffff) >>> 0));
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
// zlib-compressed filter byte 0 and one black grayscale pixel, with Adler-32.
const PNG_DATA = [0x78, 0x9c, 0x63, 0x60, 0, 0, 0, 2, 0, 1];

function pngHeader(width = 1, height = 1, depth = 8, color = 0): Uint8Array {
  return pngChunk('IHDR', [...u32(width), ...u32(height), depth, color, 0, 0, 0]);
}

function png(...chunks: Uint8Array[]): Uint8Array {
  return join(PNG_SIGNATURE, ...chunks);
}

const PNG = png(pngHeader(), pngChunk('IDAT', PNG_DATA), pngChunk('IEND'));

function segment(marker: number, payload: number[] | Uint8Array = []): Uint8Array {
  const length = payload.length + 2;
  return join([0xff, marker, length >>> 8, length & 255], payload);
}

function frame(marker = 0xc0, width = 1, height = 1): Uint8Array {
  return segment(marker, [8, height >>> 8, height & 255, width >>> 8, width & 255, 1, 1, 0x11, 0]);
}

function huffmanTable(tableClass: number, symbols = [0], codeLength = 1): number[] {
  const counts = new Array<number>(16).fill(0);
  counts[codeLength - 1] = symbols.length;
  return [tableClass << 4, ...counts, ...symbols];
}

const QUANTIZATION = segment(0xdb, [0, ...new Array<number>(64).fill(1)]);
const QUANTIZATION_16 = segment(0xdb, [
  0x10,
  ...new Array<number>(64).fill(1).flatMap(value => [value >>> 8, value & 255]),
]);
const HUFFMAN = segment(0xc4, [...huffmanTable(0), ...huffmanTable(1)]);
const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];

function scan(first = 0, last = 63, approximation = 0, selectors = 0): Uint8Array {
  return segment(0xda, [1, 1, selectors, first, last, approximation]);
}

// Real minimal 1x1 grayscale JPEG: DC category 0, AC EOB, then one-bit padding.
const JPEG = join(SOI, QUANTIZATION, frame(), HUFFMAN, scan(), [0x3f], EOI);
const PROGRESSIVE = join(
  SOI,
  QUANTIZATION,
  frame(0xc2),
  HUFFMAN,
  scan(0, 0),
  [0x7f],
  scan(1, 63),
  [0x7f],
  EOI
);

function rejects(bytes: Uint8Array, mediaType = 'image/jpeg'): void {
  expect(validateChatGptImageBytes(bytes, mediaType)).toEqual({ ok: false });
}

describe('ChatGPT image byte validation', () => {
  it('accepts the shared acquisition fixtures', () => {
    expect(validateChatGptImageBytes(validChatGptPngBytes(), 'image/png').ok).toBe(true);
    expect(validateChatGptImageBytes(validChatGptJpegBytes(), 'image/jpeg').ok).toBe(true);
  });
  it.each([
    ['PNG', PNG, 'image/png'],
    ['baseline JPEG', JPEG, 'image/jpeg'],
    ['progressive JPEG', PROGRESSIVE, 'image/jpeg'],
  ] as const)('reads dimensions from a complete minimal %s', (_label, bytes, mediaType) => {
    expect(validateChatGptImageBytes(bytes, mediaType)).toEqual({
      ok: true,
      mediaType,
      width: 1,
      height: 1,
    });
  });

  it('uses a real compressed PNG pixel fixture', () => {
    expect([...inflateSync(new Uint8Array(PNG_DATA))]).toEqual([0, 0]);
  });

  it.each(['image/jpg', 'image/webp', 'IMAGE/PNG', 'image/png; charset=binary', '', 'text/html'])(
    'rejects non-exact MIME %j',
    mime => rejects(PNG, mime)
  );

  it('rejects MIME/format mismatches and arbitrary spoofed bytes', () => {
    rejects(PNG);
    rejects(JPEG, 'image/png');
    for (const mime of ['image/png', 'image/jpeg']) {
      rejects(new TextEncoder().encode('<html>not an image</html>'), mime);
      rejects(new Uint8Array(), mime);
    }
    rejects(join(SOI, EOI));
    rejects(join(SOI, [1, 2, 3], EOI));
  });

  it('rejects every truncated prefix of the minimal fixtures', () => {
    for (const [bytes, mime] of [
      [PNG, 'image/png'],
      [JPEG, 'image/jpeg'],
      [PROGRESSIVE, 'image/jpeg'],
    ] as const) {
      for (let length = 0; length < bytes.length; length++)
        rejects(bytes.subarray(0, length), mime);
    }
  });

  describe('PNG container', () => {
    it('accepts consecutive IDATs and length-checked ancillary chunks', () => {
      const bytes = png(
        pngHeader(),
        pngChunk('tEXt', [120, 0, 121]),
        pngChunk('IDAT', PNG_DATA.slice(0, 4)),
        pngChunk('IDAT', []),
        pngChunk('IDAT', PNG_DATA.slice(4)),
        pngChunk('IEND')
      );
      expect(validateChatGptImageBytes(bytes, 'image/png').ok).toBe(true);
    });

    it.each([
      ['no IHDR', png(pngChunk('IDAT', PNG_DATA), pngChunk('IEND'))],
      [
        'duplicate IHDR',
        png(pngHeader(), pngHeader(), pngChunk('IDAT', PNG_DATA), pngChunk('IEND')),
      ],
      ['short IHDR', png(pngChunk('IHDR', new Uint8Array(12)), pngChunk('IEND'))],
      ['missing IDAT', png(pngHeader(), pngChunk('IEND'))],
      ['empty IDAT', png(pngHeader(), pngChunk('IDAT'), pngChunk('IEND'))],
      ['missing IEND', png(pngHeader(), pngChunk('IDAT', PNG_DATA))],
      ['nonempty IEND', png(pngHeader(), pngChunk('IDAT', PNG_DATA), pngChunk('IEND', [0]))],
      [
        'unknown critical chunk',
        png(pngHeader(), pngChunk('ABCD'), pngChunk('IDAT', PNG_DATA), pngChunk('IEND')),
      ],
      [
        'invalid chunk type',
        png(pngHeader(), pngChunk('a1CD'), pngChunk('IDAT', PNG_DATA), pngChunk('IEND')),
      ],
      [
        'reserved chunk bit',
        png(pngHeader(), pngChunk('abca'), pngChunk('IDAT', PNG_DATA), pngChunk('IEND')),
      ],
      [
        'separated IDATs',
        png(
          pngHeader(),
          pngChunk('IDAT', PNG_DATA),
          pngChunk('tEXt'),
          pngChunk('IDAT', PNG_DATA),
          pngChunk('IEND')
        ),
      ],
    ])('rejects %s', (_label, bytes) => rejects(bytes as Uint8Array, 'image/png'));

    it.each([
      [0, 1],
      [1, 0],
      [0x80000000, 1],
      [1, 0xffffffff],
      [0x7fffffff, 0x7fffffff],
    ])('rejects zero, out-of-range, or unsafe pixel-count dimensions %i x %i', (width, height) => {
      rejects(
        png(pngHeader(width, height), pngChunk('IDAT', PNG_DATA), pngChunk('IEND')),
        'image/png'
      );
    });

    it('rejects CRC corruption, impossible lengths, trailing bytes, and bad IHDR fields', () => {
      const corrupt = PNG.slice();
      corrupt[corrupt.length - 1] ^= 1;
      rejects(corrupt, 'image/png');
      for (const length of [0x7fffffff, 0x80000000, 0xffffffff]) {
        const badLength = PNG.slice();
        badLength.set(u32(length), 8);
        rejects(badLength, 'image/png');
      }
      rejects(join(PNG, [0]), 'image/png');
      for (const [depth, color] of [
        [3, 0],
        [8, 1],
        [16, 3],
        [1, 6],
      ]) {
        rejects(
          png(pngHeader(1, 1, depth, color), pngChunk('IDAT', PNG_DATA), pngChunk('IEND')),
          'image/png'
        );
      }
      for (const field of [10, 11, 12]) {
        const header = [...u32(1), ...u32(1), 8, 0, 0, 0, 0];
        header[field] = 2;
        rejects(
          png(pngChunk('IHDR', header), pngChunk('IDAT', PNG_DATA), pngChunk('IEND')),
          'image/png'
        );
      }
    });

    it('enforces palette shape, color restrictions, uniqueness, and ordering', () => {
      const indexed = (palette: Uint8Array[]) =>
        png(pngHeader(1, 1, 1, 3), ...palette, pngChunk('IDAT', PNG_DATA), pngChunk('IEND'));
      expect(
        validateChatGptImageBytes(indexed([pngChunk('PLTE', [0, 0, 0])]), 'image/png').ok
      ).toBe(true);
      for (const palette of [
        [],
        [pngChunk('PLTE')],
        [pngChunk('PLTE', [0])],
        [pngChunk('PLTE', new Uint8Array(9))],
        [pngChunk('PLTE', [0, 0, 0]), pngChunk('PLTE', [0, 0, 0])],
      ]) {
        rejects(indexed(palette), 'image/png');
      }
      rejects(
        png(pngHeader(), pngChunk('PLTE', [0, 0, 0]), pngChunk('IDAT', PNG_DATA), pngChunk('IEND')),
        'image/png'
      );
      rejects(
        png(
          pngHeader(1, 1, 8, 2),
          pngChunk('IDAT', PNG_DATA),
          pngChunk('PLTE', [0, 0, 0]),
          pngChunk('IEND')
        ),
        'image/png'
      );
    });
  });

  describe('JPEG segments and scans', () => {
    it('accepts ordinary extended-sequential frames, metadata, and marker fill bytes', () => {
      const bytes = join(
        SOI,
        segment(0xe0, [0xff, 0xd9]),
        segment(0xfe),
        [0xff],
        QUANTIZATION,
        frame(0xc1),
        HUFFMAN,
        scan(),
        [0x3f],
        [0xff],
        EOI
      );
      expect(validateChatGptImageBytes(bytes, 'image/jpeg').ok).toBe(true);
    });

    it('accepts entropy FF stuffing with a real single-block coefficient stream', () => {
      // DC category 0; AC coefficient size 10 at code 0000000; EOB 0000001.
      // Padded bits: 0 0000000 1111111111 0000001 1111111, stuffed after each FF.
      const tables = segment(0xc4, [...huffmanTable(0), ...huffmanTable(1, [0x0a, 0], 7)]);
      const bytes = join(
        SOI,
        QUANTIZATION,
        frame(0xc0, 8, 8),
        tables,
        scan(),
        [0, 0xff, 0, 0xc0, 0xff, 0],
        EOI
      );
      expect(validateChatGptImageBytes(bytes, 'image/jpeg')).toEqual({
        ok: true,
        mediaType: 'image/jpeg',
        width: 8,
        height: 8,
      });
    });

    it('accepts ordered restart markers only when enabled, including wraparound', () => {
      const entropy: number[] = [];
      for (let block = 0; block < 10; block++) {
        entropy.push(0x3f);
        if (block < 9) entropy.push(0xff, 0xd0 + (block % 8));
      }
      const bytes = join(
        SOI,
        QUANTIZATION,
        frame(0xc0, 80, 8),
        HUFFMAN,
        segment(0xdd, [0, 1]),
        scan(),
        entropy,
        EOI
      );
      expect(validateChatGptImageBytes(bytes, 'image/jpeg').ok).toBe(true);
    });

    it('accepts progressive initial and refinement scans with intervening segments', () => {
      const bytes = join(
        SOI,
        QUANTIZATION,
        frame(0xc2),
        HUFFMAN,
        scan(0, 0, 1),
        [0x7f],
        scan(1, 63, 1),
        [0x7f],
        segment(0xfe, [1, 2]),
        scan(0, 0, 0x10),
        [0x7f],
        scan(1, 63, 0x10),
        [0x7f],
        EOI
      );
      expect(validateChatGptImageBytes(bytes, 'image/jpeg').ok).toBe(true);
    });

    it.each([
      [
        'extended-sequential',
        join(SOI, QUANTIZATION_16, frame(0xc1), HUFFMAN, scan(), [0x3f], EOI),
      ],
      [
        'progressive',
        join(
          SOI,
          QUANTIZATION_16,
          frame(0xc2),
          HUFFMAN,
          scan(0, 0),
          [0x7f],
          scan(1, 63),
          [0x7f],
          EOI
        ),
      ],
    ] as const)(
      'rejects 16-bit quantization tables for supported 8-bit %s frames',
      (_kind, bytes) => {
        rejects(bytes);
      }
    );

    it('rejects quantization value changes between progressive scans', () => {
      const changed = segment(0xdb, [0, ...new Array<number>(64).fill(2)]);
      rejects(
        join(
          SOI,
          QUANTIZATION,
          frame(0xc2),
          HUFFMAN,
          scan(0, 0),
          [0x7f],
          changed,
          scan(1, 63),
          [0x7f],
          EOI
        )
      );
    });

    it('accepts separate sequential component scans and requires every component', () => {
      const colorFrame = segment(0xc0, [8, 0, 1, 0, 1, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]);
      const prefix = join(SOI, QUANTIZATION, colorFrame, HUFFMAN);
      const componentScan = (id: number) => join(segment(0xda, [1, id, 0, 0, 63, 0]), [0x3f]);
      const bytes = join(prefix, componentScan(1), componentScan(2), componentScan(3), EOI);
      expect(validateChatGptImageBytes(bytes, 'image/jpeg').ok).toBe(true);
      rejects(join(prefix, componentScan(1), componentScan(2), EOI));
      rejects(join(prefix, componentScan(1), componentScan(1), componentScan(3), EOI));
      rejects(join(prefix, segment(0xda, [2, 1, 0, 1, 0, 0, 63, 0]), [0x3f], EOI));
    });

    it('rejects invalid interleaved sampling totals and baseline table selectors', () => {
      const excessiveSampling = segment(0xc0, [8, 0, 1, 0, 1, 2, 1, 0x44, 0, 2, 0x44, 0]);
      rejects(
        join(
          SOI,
          QUANTIZATION,
          excessiveSampling,
          HUFFMAN,
          segment(0xda, [2, 1, 0, 2, 0, 0, 63, 0]),
          [0x0f],
          EOI
        )
      );
      const tableTwo = huffmanTable(0);
      tableTwo[0] = 2;
      rejects(
        join(
          SOI,
          QUANTIZATION,
          frame(),
          HUFFMAN,
          segment(0xc4, tableTwo),
          scan(0, 63, 0, 0x20),
          [0x3f],
          EOI
        )
      );
    });

    it.each([
      ['missing SOF', join(SOI, QUANTIZATION, HUFFMAN, scan(), [0x3f], EOI)],
      ['missing SOS', join(SOI, QUANTIZATION, frame(), HUFFMAN, EOI)],
      ['missing EOI', JPEG.subarray(0, JPEG.length - 2)],
      ['missing quantization table', join(SOI, frame(), HUFFMAN, scan(), [0x3f], EOI)],
      ['missing Huffman tables', join(SOI, QUANTIZATION, frame(), scan(), [0x3f], EOI)],
      ['empty entropy', join(SOI, QUANTIZATION, frame(), HUFFMAN, scan(), EOI)],
      ['duplicate frame', join(SOI, QUANTIZATION, frame(), frame(), HUFFMAN, scan(), [0x3f], EOI)],
      ['zero width', join(SOI, QUANTIZATION, frame(0xc0, 0), HUFFMAN, scan(), [0x3f], EOI)],
      ['zero height', join(SOI, QUANTIZATION, frame(0xc0, 1, 0), HUFFMAN, scan(), [0x3f], EOI)],
      [
        'unsupported lossless frame',
        join(SOI, QUANTIZATION, frame(0xc3), HUFFMAN, scan(), [0x3f], EOI),
      ],
      ['trailing bytes', join(JPEG, [0])],
      ['concatenated JPEG', join(JPEG, JPEG)],
      ['stuffing outside entropy', join(SOI, [0xff, 0], JPEG.subarray(2))],
      [
        'unenabled restart',
        join(SOI, QUANTIZATION, frame(), HUFFMAN, scan(), [0x3f, 0xff, 0xd0, 0x3f], EOI),
      ],
      [
        'wrong restart order',
        join(
          SOI,
          QUANTIZATION,
          frame(),
          HUFFMAN,
          segment(0xdd, [0, 1]),
          scan(),
          [0x3f, 0xff, 0xd1, 0x3f],
          EOI
        ),
      ],
      [
        'restart without final entropy',
        join(
          SOI,
          QUANTIZATION,
          frame(),
          HUFFMAN,
          segment(0xdd, [0, 1]),
          scan(),
          [0x3f, 0xff, 0xd0],
          EOI
        ),
      ],
      [
        'invalid stuffing after fill',
        join(SOI, QUANTIZATION, frame(), HUFFMAN, scan(), [0x3f, 0xff, 0xff, 0], EOI),
      ],
      [
        'unknown entropy marker',
        join(SOI, QUANTIZATION, frame(), HUFFMAN, scan(), [0x3f, 0xff, 0x02, 0, 2], EOI),
      ],
      [
        'nonsequential baseline scan',
        join(SOI, QUANTIZATION, frame(), HUFFMAN, scan(1, 63), [0x3f], EOI),
      ],
      [
        'AC before progressive DC',
        join(SOI, QUANTIZATION, frame(0xc2), HUFFMAN, scan(1, 63), [0x7f], EOI),
      ],
      [
        'refinement without initial scan',
        join(SOI, QUANTIZATION, frame(0xc2), HUFFMAN, scan(0, 0, 0x10), [0x7f], EOI),
      ],
      [
        'invalid progressive spectral range',
        join(SOI, QUANTIZATION, frame(0xc2), HUFFMAN, scan(0, 63), [0x7f], EOI),
      ],
      [
        'duplicate initial scan',
        join(PROGRESSIVE.subarray(0, PROGRESSIVE.length - 2), scan(0, 0), [0x7f], EOI),
      ],
    ])('rejects %s', (_label, bytes) => rejects(bytes as Uint8Array));

    it('rejects corrupt and truncated marker lengths, including metadata and tables', () => {
      for (const marker of [0xc0, 0xc4, 0xda, 0xdb, 0xdd, 0xe1, 0xfe]) {
        for (const length of [0, 1, 0xffff]) {
          rejects(join(SOI, [0xff, marker, length >>> 8, length & 255, 0], EOI));
        }
      }
      rejects(join(SOI, segment(0xdd, [0]), JPEG.subarray(2)));
      rejects(join(SOI, [0xff]));
    });

    it('rejects malformed tables, SOF components and SOS references', () => {
      const badSegments = [
        segment(0xdb),
        segment(0xdb, [0, ...new Array<number>(64).fill(0)]),
        segment(0xdb, [0x20, ...new Array<number>(64).fill(1)]),
        segment(0xc4),
        segment(0xc4, huffmanTable(0, [0, 1])), // complete Huffman tree
        segment(0xc4, huffmanTable(0, [12])),
        segment(0xc4, huffmanTable(1, [11])),
        segment(0xc4, huffmanTable(1, [0, 0], 2)),
        segment(0xc0, [8, 0, 1, 0, 1, 0]),
        segment(0xc0, [12, 0, 1, 0, 1, 1, 1, 0x11, 0]),
        segment(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x01, 0]),
        segment(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 4]),
      ];
      for (const bad of badSegments) rejects(join(SOI, bad, JPEG.subarray(2)));
      for (const payload of [[0], [1, 2, 0, 0, 63, 0], [1, 1, 0x44, 0, 63, 0]]) {
        rejects(join(SOI, QUANTIZATION, frame(), HUFFMAN, segment(0xda, payload), [0x3f], EOI));
      }
    });
  });

  it('keeps byte reads linear for bounded larger PNG/JPEG payloads and FF runs', () => {
    const payload = new Uint8Array(256 * 1024).fill(0x3f);
    const fillRun = join(SOI, new Uint8Array(payload.length).fill(0xff), EOI);
    for (const [bytes, mime, accepted] of [
      [join(SOI, QUANTIZATION, frame(), HUFFMAN, scan(), payload, EOI), 'image/jpeg', true],
      [
        png(pngHeader(), pngChunk('tEXt', payload), pngChunk('IDAT', PNG_DATA), pngChunk('IEND')),
        'image/png',
        true,
      ],
      [fillRun, 'image/jpeg', false],
    ] as const) {
      let reads = 0;
      const observed = new Proxy(bytes, {
        get(target, property) {
          if (typeof property === 'string' && /^\d+$/.test(property)) reads++;
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      expect(validateChatGptImageBytes(observed, mime).ok).toBe(accepted);
      expect(reads).toBeLessThan(bytes.length * 3);
    }
  });
});
