/**
 * Dependency-free structural checks for acquired PNG and ordinary 8-bit Huffman
 * JPEG bytes. This is not a pixel decoder: zlib/DCT entropy is not decompressed.
 * Every cursor advances within the input; tables/components have fixed bounds.
 */

export type ChatGptImageValidationResult =
  | { ok: true; mediaType: 'image/png' | 'image/jpeg'; width: number; height: number }
  | { ok: false };

interface Dimensions {
  width: number;
  height: number;
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function uint16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 256 + bytes[offset + 1];
}

function uint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 256 +
    bytes[offset + 3]
  );
}

function pngCrc(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let offset = start; offset < end; offset++) {
    crc = CRC_TABLE[(crc ^ bytes[offset]) & 255] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngHeader(bytes: Uint8Array, offset: number): Dimensions | undefined {
  const width = uint32(bytes, offset);
  const height = uint32(bytes, offset + 4);
  const depth = bytes[offset + 8];
  const color = bytes[offset + 9];
  const validDepth =
    color === 0
      ? [1, 2, 4, 8, 16].includes(depth)
      : color === 3
        ? [1, 2, 4, 8].includes(depth)
        : [2, 4, 6].includes(color) && [8, 16].includes(depth);
  if (
    width === 0 ||
    height === 0 ||
    width > 0x7fffffff ||
    height > 0x7fffffff ||
    !Number.isSafeInteger(width * height) ||
    !validDepth ||
    bytes[offset + 10] !== 0 ||
    bytes[offset + 11] !== 0 ||
    bytes[offset + 12] > 1
  ) {
    return undefined;
  }
  return { width, height };
}

interface PngChunk {
  type: string;
  length: number;
  typeOffset: number;
  data: number;
  end: number;
}

interface PngState {
  dimensions?: Dimensions;
  palette: boolean;
  imageData: boolean;
  imageDataEnded: boolean;
  imageDataBytes: number;
}

function pngChunk(bytes: Uint8Array, cursor: number): PngChunk | undefined {
  if (bytes.length - cursor < 12) return undefined;
  const length = uint32(bytes, cursor);
  if (length > 0x7fffffff || length > bytes.length - cursor - 12) return undefined;
  const typeOffset = cursor + 4;
  const data = cursor + 8;
  const end = data + length;
  for (let index = typeOffset; index < data; index++) {
    const letter = bytes[index];
    if (!((letter >= 65 && letter <= 90) || (letter >= 97 && letter <= 122))) {
      return undefined;
    }
  }
  if (bytes[typeOffset + 2] & 32) return undefined;
  if (pngCrc(bytes, typeOffset, end) !== uint32(bytes, end)) return undefined;
  return {
    type: String.fromCharCode(...bytes.subarray(typeOffset, data)),
    length,
    typeOffset,
    data,
    end,
  };
}

function validPngPalette(bytes: Uint8Array, chunk: PngChunk, state: PngState): boolean {
  const color = bytes[25];
  return !(
    state.palette ||
    state.imageData ||
    chunk.length === 0 ||
    chunk.length > 768 ||
    chunk.length % 3 !== 0 ||
    color === 0 ||
    color === 4 ||
    (color === 3 && chunk.length / 3 > 2 ** bytes[24])
  );
}

function applyPngHeader(bytes: Uint8Array, chunk: PngChunk, state: PngState): boolean {
  if (state.dimensions !== undefined || chunk.length !== 13) return false;
  state.dimensions = pngHeader(bytes, chunk.data);
  return state.dimensions !== undefined;
}

function applyPngChunk(bytes: Uint8Array, chunk: PngChunk, state: PngState): boolean {
  const { type, length } = chunk;
  if (state.dimensions === undefined && type !== 'IHDR') return false;
  if (type === 'IHDR') {
    if (!applyPngHeader(bytes, chunk, state)) return false;
  } else if (type === 'PLTE') {
    if (!validPngPalette(bytes, chunk, state)) return false;
    state.palette = true;
  } else if (type === 'IDAT') {
    if (state.imageDataEnded || (bytes[25] === 3 && !state.palette)) return false;
    state.imageData = true;
    state.imageDataBytes += length;
  } else if (type !== 'IEND' && !(bytes[chunk.typeOffset] & 32)) {
    // Unknown ancillary chunks are safely skippable; unknown critical ones are not.
    return false;
  }
  if (state.imageData && type !== 'IDAT') state.imageDataEnded = true;
  return true;
}

function validatePng(bytes: Uint8Array): Dimensions | undefined {
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return undefined;
  const state: PngState = {
    palette: false,
    imageData: false,
    imageDataEnded: false,
    imageDataBytes: 0,
  };
  let cursor = PNG_SIGNATURE.length;
  while (cursor < bytes.length) {
    const chunk = pngChunk(bytes, cursor);
    if (chunk === undefined || !applyPngChunk(bytes, chunk, state)) return undefined;
    if (chunk.type === 'IEND') {
      return chunk.length === 0 && state.imageDataBytes > 0 && chunk.end + 4 === bytes.length
        ? state.dimensions
        : undefined;
    }
    cursor = chunk.end + 4;
  }
  return undefined;
}

interface JpegComponent {
  id: number;
  quantizationTable: number;
  samplingBlocks: number;
  coefficients: Int8Array;
  /** Progressive scans must keep using the same quantization values. */
  progressiveQuantization?: Uint16Array;
}

interface JpegFrame extends Dimensions {
  marker: number;
  components: JpegComponent[];
}

interface JpegTables {
  quantization: Map<number, { precision: number; values: Uint16Array }>;
  dc: Set<number>;
  ac: Set<number>;
}

function equalUint16(left: Uint16Array, right: Uint16Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function jpegFrame(
  bytes: Uint8Array,
  start: number,
  end: number,
  marker: number
): JpegFrame | undefined {
  if (end - start < 9 || bytes[start] !== 8) return undefined;
  const height = uint16(bytes, start + 1);
  const width = uint16(bytes, start + 3);
  const count = bytes[start + 5];
  if (!width || !height || count < 1 || count > 4 || end - start !== 6 + count * 3) {
    return undefined;
  }
  const components: JpegComponent[] = [];
  for (let offset = start + 6; offset < end; offset += 3) {
    const id = bytes[offset];
    const horizontal = bytes[offset + 1] >>> 4;
    const vertical = bytes[offset + 1] & 15;
    const quantizationTable = bytes[offset + 2];
    if (
      components.some(component => component.id === id) ||
      horizontal < 1 ||
      horizontal > 4 ||
      vertical < 1 ||
      vertical > 4 ||
      quantizationTable > 3
    ) {
      return undefined;
    }
    components.push({
      id,
      quantizationTable,
      samplingBlocks: horizontal * vertical,
      coefficients: new Int8Array(64).fill(-1),
    });
  }
  return { width, height, marker, components };
}

function jpegQuantization(
  bytes: Uint8Array,
  start: number,
  end: number,
  tables: JpegTables
): boolean {
  if (start === end) return false;
  while (start < end) {
    const precision = bytes[start] >>> 4;
    const id = bytes[start++] & 15;
    if (precision > 1 || id > 3 || end - start < 64 * (precision + 1)) return false;
    const values = new Uint16Array(64);
    for (let count = 0; count < 64; count++) {
      const value = precision === 0 ? bytes[start] : uint16(bytes, start);
      if (value === 0) return false;
      values[count] = value;
      start += precision + 1;
    }
    tables.quantization.set(id, { precision, values });
  }
  return true;
}

function validJpegHuffmanSymbols(
  bytes: Uint8Array,
  start: number,
  count: number,
  tableClass: number
): boolean {
  const symbols = new Set<number>();
  for (let index = 0; index < count; index++) {
    const symbol = bytes[start + index];
    if (symbols.has(symbol) || (tableClass === 0 ? symbol > 11 : (symbol & 15) > 10)) {
      return false;
    }
    symbols.add(symbol);
  }
  return true;
}

function jpegHuffman(bytes: Uint8Array, start: number, end: number, tables: JpegTables): boolean {
  if (start === end) return false;
  while (start < end) {
    if (end - start < 17) return false;
    const tableClass = bytes[start] >>> 4;
    const id = bytes[start++] & 15;
    if (tableClass > 1 || id > 3) return false;
    let count = 0;
    let available = 1;
    for (let index = 0; index < 16; index++) {
      const atLength = bytes[start++];
      count += atLength;
      available = available * 2 - atLength;
      // JPEG reserves the all-ones code, so even a complete tree is invalid.
      if (available <= 0) return false;
    }
    if (count === 0 || count > 256 || count > end - start) return false;
    if (!validJpegHuffmanSymbols(bytes, start, count, tableClass)) return false;
    start += count;
    (tableClass === 0 ? tables.dc : tables.ac).add(id);
  }
  return true;
}

interface JpegScan {
  count: number;
  first: number;
  last: number;
  high: number;
  low: number;
  progressive: boolean;
}

function validProgressiveJpegScan(scan: JpegScan): boolean {
  return (
    scan.first <= scan.last &&
    scan.last <= 63 &&
    scan.high <= 13 &&
    scan.low <= 13 &&
    (scan.first === 0 ? scan.last === 0 : scan.count === 1)
  );
}

function jpegScanHeader(
  bytes: Uint8Array,
  start: number,
  end: number,
  frame: JpegFrame
): JpegScan | undefined {
  const count = bytes[start];
  if (!count || count > 4 || end - start !== 4 + count * 2) return undefined;
  const first = bytes[end - 3];
  const last = bytes[end - 2];
  const high = bytes[end - 1] >>> 4;
  const low = bytes[end - 1] & 15;
  const progressive = frame.marker === 0xc2;
  const scan = { count, first, last, high, low, progressive };
  if (high !== 0 && low !== high - 1) return undefined;
  if (progressive) return validProgressiveJpegScan(scan) ? scan : undefined;
  return first === 0 && last === 63 && high === 0 && low === 0 ? scan : undefined;
}

function validJpegTableSelectors(dc: number, ac: number, frame: JpegFrame): boolean {
  return dc <= 3 && ac <= 3 && (frame.marker !== 0xc0 || (dc <= 1 && ac <= 1));
}

function validJpegScanHuffman(dc: number, ac: number, scan: JpegScan, tables: JpegTables): boolean {
  if ((!scan.progressive || (scan.first === 0 && scan.high === 0)) && !tables.dc.has(dc)) {
    return false;
  }
  if ((!scan.progressive || scan.first > 0) && !tables.ac.has(ac)) return false;
  return !scan.progressive || (scan.first === 0 ? ac === 0 : dc === 0);
}

function jpegScanQuantization(
  component: JpegComponent,
  scan: JpegScan,
  tables: JpegTables
): boolean {
  const quantization = tables.quantization.get(component.quantizationTable);
  if (quantization === undefined || quantization.precision !== 0) return false;
  if (scan.progressive) {
    if (
      component.progressiveQuantization !== undefined &&
      !equalUint16(component.progressiveQuantization, quantization.values)
    ) {
      return false;
    }
    if (component.progressiveQuantization === undefined) {
      component.progressiveQuantization = quantization.values.slice();
    }
  }
  return true;
}

function jpegScanCoefficients(component: JpegComponent, scan: JpegScan): boolean {
  if (scan.first > 0 && scan.progressive && component.coefficients[0] < 0) return false;
  for (let coefficient = scan.first; coefficient <= scan.last; coefficient++) {
    const previous = component.coefficients[coefficient];
    if (scan.high === 0 ? previous !== -1 : previous !== scan.high) return false;
    component.coefficients[coefficient] = scan.low;
  }
  return true;
}

function jpegScan(
  bytes: Uint8Array,
  start: number,
  end: number,
  frame: JpegFrame,
  tables: JpegTables
): boolean {
  const scan = jpegScanHeader(bytes, start, end, frame);
  if (scan === undefined) return false;
  const selected = new Set<number>();
  let samplingBlocks = 0;
  for (let offset = start + 1; offset < end - 3; offset += 2) {
    const component = frame.components.find(value => value.id === bytes[offset]);
    if (component === undefined || selected.has(component.id)) return false;
    const dc = bytes[offset + 1] >>> 4;
    const ac = bytes[offset + 1] & 15;
    if (
      !validJpegTableSelectors(dc, ac, frame) ||
      !validJpegScanHuffman(dc, ac, scan, tables) ||
      !jpegScanQuantization(component, scan, tables) ||
      !jpegScanCoefficients(component, scan)
    ) {
      return false;
    }
    samplingBlocks += component.samplingBlocks;
    selected.add(component.id);
  }
  return scan.count === 1 || samplingBlocks <= 10;
}

/** Return the next marker's offset, never skipping it as entropy data. */
function jpegEntropyEnd(bytes: Uint8Array, start: number, restartInterval: number): number {
  let cursor = start;
  let dataBytes = 0;
  let nextRestart = 0xd0;
  while (cursor < bytes.length) {
    if (bytes[cursor++] !== 0xff) {
      dataBytes++;
      continue;
    }
    const markerStart = cursor - 1;
    while (cursor < bytes.length && bytes[cursor] === 0xff) cursor++;
    if (cursor === bytes.length) return -1;
    const marker = bytes[cursor++];
    if (marker === 0) {
      if (cursor - markerStart !== 2) return -1;
      dataBytes++;
    } else if (marker >= 0xd0 && marker <= 0xd7) {
      if (!restartInterval || marker !== nextRestart || dataBytes === 0) return -1;
      nextRestart = 0xd0 + ((nextRestart - 0xd0 + 1) % 8);
      dataBytes = 0;
    } else {
      return dataBytes > 0 ? markerStart : -1;
    }
  }
  return -1;
}

interface JpegState {
  tables: JpegTables;
  frame?: JpegFrame;
  scans: number;
  restartInterval: number;
}

interface JpegSegment {
  marker: number;
  start: number;
  end: number;
}

function applyJpegTablesOrMetadata(
  bytes: Uint8Array,
  segment: JpegSegment,
  state: JpegState
): boolean {
  const { marker, start, end } = segment;
  if (marker === 0xdb) return jpegQuantization(bytes, start, end, state.tables);
  if (marker === 0xc4) return jpegHuffman(bytes, start, end, state.tables);
  if (marker === 0xdd) {
    if (end - start !== 2) return false;
    state.restartInterval = uint16(bytes, start);
    return true;
  }
  // Reject duplicate SOI, standalone restart/TEM, arithmetic, lossless,
  // hierarchical, deferred-height, and reserved/unknown coding structures.
  return (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
}

function applyJpegSegment(
  bytes: Uint8Array,
  segment: JpegSegment,
  state: JpegState
): number | undefined {
  const { marker, start, end } = segment;
  if (marker >= 0xc0 && marker <= 0xc2) {
    if (state.frame !== undefined) return undefined;
    state.frame = jpegFrame(bytes, start, end, marker);
    return state.frame === undefined ? undefined : end;
  }
  if (marker === 0xda) {
    if (state.frame === undefined || !jpegScan(bytes, start, end, state.frame, state.tables)) {
      return undefined;
    }
    const cursor = jpegEntropyEnd(bytes, end, state.restartInterval);
    if (cursor < 0) return undefined;
    state.scans++;
    return cursor;
  }
  return applyJpegTablesOrMetadata(bytes, segment, state) ? end : undefined;
}

function completedJpeg(state: JpegState, cursor: number, length: number): Dimensions | undefined {
  return state.frame &&
    state.scans > 0 &&
    cursor === length &&
    state.frame.components.every(component => component.coefficients[0] >= 0)
    ? { width: state.frame.width, height: state.frame.height }
    : undefined;
}

function validateJpeg(bytes: Uint8Array): Dimensions | undefined {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  const state: JpegState = {
    tables: { quantization: new Map(), dc: new Set(), ac: new Set() },
    scans: 0,
    restartInterval: 0,
  };
  let cursor = 2;
  while (cursor < bytes.length) {
    if (bytes[cursor++] !== 0xff) return undefined;
    while (cursor < bytes.length && bytes[cursor] === 0xff) cursor++;
    if (cursor === bytes.length) return undefined;
    const marker = bytes[cursor++];
    if (marker === 0xd9) return completedJpeg(state, cursor, bytes.length);
    if (bytes.length - cursor < 2) return undefined;
    const length = uint16(bytes, cursor);
    if (length < 2 || length > bytes.length - cursor) return undefined;
    const start = cursor + 2;
    const end = cursor + length;
    const next = applyJpegSegment(bytes, { marker, start, end }, state);
    if (next === undefined) return undefined;
    cursor = next;
  }
  return undefined;
}

/** Exact MIME is deliberate; callers must not infer it from a URL or filename. */
export function validateChatGptImageBytes(
  bytes: Uint8Array,
  mediaType: string
): ChatGptImageValidationResult {
  if (mediaType !== 'image/png' && mediaType !== 'image/jpeg') return { ok: false };
  const dimensions = mediaType === 'image/png' ? validatePng(bytes) : validateJpeg(bytes);
  return dimensions ? { ok: true, mediaType, ...dimensions } : { ok: false };
}
