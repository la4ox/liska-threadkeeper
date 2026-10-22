import { Buffer } from 'node:buffer';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==';
const JPEG_BASE64 =
  '/9j/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAJgABAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAAPwA//9k=';

function bytes(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

function join(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function u32(value: number): Uint8Array {
  return Uint8Array.of(value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const content = join(typeBytes, data);
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return join(u32(data.byteLength), content, u32((crc ^ 0xffffffff) >>> 0));
}

export function validChatGptPngBytes(variant = 0): Uint8Array {
  const base = bytes(PNG_BASE64);
  if (variant === 0) return base;
  // Insert a harmless, CRC-valid tEXt chunk after IHDR so content hashes differ.
  return join(
    base.subarray(0, 33),
    pngChunk('tEXt', Uint8Array.of(118, 0, variant & 255)),
    base.subarray(33)
  );
}

export function validChatGptJpegBytes(): Uint8Array {
  return bytes(JPEG_BASE64);
}
