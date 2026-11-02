/** Node-only, resource-bounded artifact admission and ZIP extraction. */
import { createHash } from 'node:crypto';
import { spawn } from 'child_process';
import { Buffer } from 'node:buffer';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { crc32 } from 'node:zlib';
import { TextDecoder } from 'node:util';
import { getFileNameLowLevel, openPromise } from 'yauzl';
import { clearTimeout, setTimeout } from 'node:timers';

export const BUILD_COMPARE_LIMITS = Object.freeze({
  archiveBytes: 64 * 1024 * 1024,
  entries: 4096,
  entryBytes: 32 * 1024 * 1024,
  totalBytes: 128 * 1024 * 1024,
  ratio: 200,
  pathBytes: 1024,
  depth: 32,
  metadataBytes: 1024 * 1024,
});

/** Test overrides may tighten, but never expand, the production boundary. */
export function comparisonLimits(overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new Error('invalid comparison limits');
  }
  const limits = { ...BUILD_COMPARE_LIMITS };
  for (const [name, value] of Object.entries(overrides)) {
    if (
      !Object.hasOwn(limits, name) ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > limits[name]
    ) {
      throw new Error(`invalid comparison limit: ${name}`);
    }
    limits[name] = value;
  }
  return limits;
}

export function within(value, ceiling, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > ceiling) {
    throw new Error(`${label} exceeds comparison limit (${ceiling})`);
  }
}

/** Reject portable-path aliases before they can reach the filesystem. */
export function portablePath(name, directory, limits) {
  within(Buffer.byteLength(name, 'utf8'), limits.pathBytes, 'path bytes');
  if (directory && name === './') return '';
  if (name.startsWith('./')) name = name.slice(2);
  if (directory && name.endsWith('/')) name = name.slice(0, -1);
  // Also reject Windows wildcard/stream syntax and C1 controls on every OS.
  if (/[\\:<>"|?*]|\p{Cc}/u.test(name) || name.startsWith('/')) {
    throw new Error('unsafe archive path');
  }
  const segments = name.split('/');
  within(segments.length, limits.depth, 'path depth');
  for (const segment of segments) {
    const device = segment.split('.')[0].replace(/[ .]+$/u, '');
    if (
      !segment ||
      segment === '.' ||
      segment === '..' ||
      /[ .]$/u.test(segment) ||
      Buffer.byteLength(segment, 'utf8') > 255 ||
      /^(?:con|prn|aux|nul|conin\$|conout\$|clock\$|com[1-9¹²³]|lpt[1-9¹²³])$/iu.test(device)
    ) {
      throw new Error('unsafe archive path segment');
    }
  }
  return name;
}

function pathKey(name) {
  return name.normalize('NFC').toUpperCase().toLowerCase();
}

function pathNode(name = '') {
  return { name, children: new Map(), directory: true, explicit: false };
}

function registerPath(root, name, directory) {
  // A trie accounts for each segment once, rather than storing/copying all
  // full ancestor paths (quadratic work for deeply nested metadata).
  let current = root;
  for (const segment of name ? name.split('/') : []) {
    if (!current.directory) throw new Error('file/directory ancestor conflict');
    const key = pathKey(segment);
    let next = current.children.get(key);
    if (next && next.name !== segment) throw new Error('Unicode/case path alias');
    if (!next) {
      next = pathNode(segment);
      current.children.set(key, next);
    }
    current = next;
  }
  if (current.explicit || (!directory && current.children.size)) {
    throw new Error('duplicate or conflicting archive path');
  }
  current.explicit = true;
  current.directory = directory;
}

export async function admitArchive(path, overrides = {}) {
  const limits = comparisonLimits(overrides);
  const info = await stat(path);
  if (!info.isFile()) throw new Error('ZIP must be a regular file');
  within(info.size, limits.archiveBytes, 'archive bytes');
  return info.size;
}

/** A streamed hash for release digest admission; never buffers the artifact. */
export async function archiveSha256(path) {
  const hash = createHash('sha256');
  let count = 0;
  for await (const chunk of createReadStream(path)) {
    count += chunk.length;
    within(count, BUILD_COMPARE_LIMITS.archiveBytes, 'archive bytes');
    hash.update(chunk);
  }
  return hash.digest('hex');
}

/** Stream one already-admitted numeric asset identity; never re-resolve its tag/name. */
export async function downloadReleaseAsset(asset, destination, options = {}) {
  const limits = comparisonLimits(options.limits);
  within(asset.size, limits.archiveBytes, 'release archive bytes');
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
  within(timeoutMs, 10 * 60 * 1000, 'download timeout');
  if (!timeoutMs) throw new Error('download timeout must be positive');
  // A successfully opened create-only handle is the ownership/cleanup boundary.
  const file = await open(destination, 'wx');
  const controller = new globalThis.AbortController();
  const stderr = [];
  let stderrBytes = 0;
  let bytes = 0;
  let child;
  let output;
  let timer;
  let failure;
  let caughtError;
  let closeError;
  let settleExit;
  const exited = new Promise(resolve => {
    settleExit = resolve;
  });
  const hash = createHash('sha256');
  function abort(error) {
    if (failure) return;
    failure = error;
    // Failure must not wait for a child close event that may never arrive.
    // Its later events remain handled; only a successful close can admit output.
    settleExit(error);
    controller.abort(error);
    child?.stdout?.destroy();
    child?.stderr?.destroy();
    try {
      child?.kill('SIGKILL');
    } catch {
      /* Preserve the original failure. */
    }
  }
  try {
    child = spawn(
      'gh',
      ['api', asset.endpoint, '--hostname', 'github.com', '-H', 'Accept: application/octet-stream'],
      {
        cwd: options.cwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    child.on('error', abort);
    child.once('close', (code, signal) => {
      if (code !== 0) {
        const diagnostic = Buffer.concat(stderr, stderrBytes).toString('utf8');
        abort(new Error(`gh api download failed (${signal ?? code}): ${diagnostic}`));
      }
      settleExit(failure ?? null);
    });
    if (!child.stdout || !child.stderr) throw new Error('gh api download requires piped output');
    child.stderr.on('data', chunk => {
      const retained = Buffer.from(chunk.subarray(0, Math.max(0, 8192 - stderrBytes)));
      if (retained.length) {
        stderr.push(retained);
        stderrBytes += retained.length;
      }
    });
    child.stderr.on('error', abort);
    output = file.createWriteStream({ autoClose: false });
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        // Reject the overflowing chunk BEFORE it can reach the file or hash.
        if (chunk.length > Math.min(asset.size, limits.archiveBytes) - bytes) {
          callback(new Error('release download exceeds admitted archive byte limit'));
          return;
        }
        bytes += chunk.length;
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    timer = setTimeout(() => abort(new Error('gh api download timed out')), timeoutMs);
    const streamed = pipeline(child.stdout, meter, output, { signal: controller.signal }).then(
      () => null,
      error => {
        abort(error);
        return error;
      }
    );
    const [streamError, exitError] = await Promise.all([streamed, exited]);
    if (failure || streamError || exitError) throw failure ?? streamError ?? exitError;
    if (bytes !== asset.size)
      throw new Error('downloaded ZIP size does not match release metadata');
    if (asset.digest && hash.digest('hex') !== asset.digest.slice(7)) {
      throw new Error('downloaded ZIP SHA-256 does not match release metadata');
    }
  } catch (error) {
    abort(error);
    caughtError = error;
  } finally {
    clearTimeout(timer);
    output?.destroy();
    try {
      await file.close();
    } catch (error) {
      closeError = error;
    }
    if (failure || closeError) await rm(destination, { force: true });
  }
  // Keep cleanup out of the control-flow path and preserve the primary failure.
  if (caughtError) throw caughtError;
  if (closeError) throw closeError;
}

function validateNameEncoding(entry) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const rawCrc = crc32(entry.fileNameRaw);
  let unicode = Boolean(entry.generalPurposeBitFlag & 0x800);
  if (unicode) decoder.decode(entry.fileNameRaw);
  for (const field of entry.extraFields) {
    if (field.id === 0x7075 && field.data.length >= 6 && field.data[0] === 1) {
      if (field.data.readUInt32LE(1) === rawCrc) {
        decoder.decode(field.data.subarray(5));
        unicode = true;
      }
    }
  }
  if (!unicode && entry.fileNameRaw.some(byte => byte >= 0x80)) {
    throw new Error('ambiguous non-ASCII ZIP filename: UTF-8 metadata required');
  }
  return getFileNameLowLevel(entry.generalPurposeBitFlag, entry.fileNameRaw, [], true);
}

function validateEntry(entry, limits) {
  const rawName = validateNameEncoding(entry);
  if (entry.generalPurposeBitFlag & ~0x80e) {
    throw new Error('encrypted or unsupported ZIP flags');
  }
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    throw new Error('only STORE and DEFLATE ZIP entries are supported');
  }
  const type = (entry.externalFileAttributes >>> 16) & 0xf000;
  const directory = entry.fileName.endsWith('/');
  if (directory !== rawName.endsWith('/')) throw new Error('inconsistent Unicode directory name');
  portablePath(rawName, directory, limits);
  if (type !== 0 && type !== 0x8000 && type !== 0x4000) {
    throw new Error('symlink or special ZIP entry is not supported');
  }
  if (entry.externalFileAttributes & (0x08 | 0x40 | 0x400)) {
    throw new Error('DOS volume/device or reparse ZIP entry is not supported');
  }
  if ((type === 0x4000 || entry.externalFileAttributes & 0x10) && !directory) {
    throw new Error('inconsistent ZIP directory entry');
  }
  if (directory && (type === 0x8000 || entry.uncompressedSize !== 0)) {
    throw new Error('inconsistent ZIP directory contents');
  }
  within(entry.compressedSize, limits.archiveBytes, 'compressed entry bytes');
  within(entry.uncompressedSize, limits.entryBytes, 'entry bytes');
  if (entry.uncompressedSize > entry.compressedSize * limits.ratio) {
    throw new Error('entry compression ratio exceeds comparison limit');
  }
  return { entry, directory, name: portablePath(entry.fileName, directory, limits) };
}

/** Inventory the entire central directory and local metadata before any write. */
async function inventory(zip, limits) {
  within(zip.entryCount, limits.entries, 'entries');
  const records = [];
  const paths = pathNode();
  let metadata = 22 + Buffer.byteLength(zip.comment, 'utf8');
  within(metadata, limits.metadataBytes, 'metadata bytes');
  let expanded = 0;
  let compressed = 0;
  for await (const entry of zip.eachEntry()) {
    within(records.length + 1, limits.entries, 'entries');
    metadata +=
      46 +
      entry.fileNameLength +
      entry.extraFieldLength +
      entry.fileCommentLength +
      Buffer.byteLength(entry.fileName, 'utf8');
    within(metadata, limits.metadataBytes, 'metadata bytes');
    const record = validateEntry(entry, limits);
    registerPath(paths, record.name, record.directory);
    expanded += entry.uncompressedSize;
    compressed += entry.compressedSize;
    within(expanded, limits.totalBytes, 'aggregate expanded bytes');
    within(compressed, limits.archiveBytes, 'aggregate compressed bytes');
    if (expanded > compressed * limits.ratio)
      throw new Error('aggregate compression ratio exceeded');
    records.push(record);
  }
  // Check local names/flags too: the central name is the only extraction authority,
  // but disagreement is malformed input, not another path to reinterpret.
  for (const { entry } of records) {
    const local = await zip.readLocalFileHeaderPromise(entry);
    metadata += 30 + local.fileNameLength + local.extraFieldLength;
    within(metadata, limits.metadataBytes, 'metadata bytes');
    if (
      !local.fileName.equals(entry.fileNameRaw) ||
      local.generalPurposeBitFlag !== entry.generalPurposeBitFlag ||
      local.compressionMethod !== entry.compressionMethod
    ) {
      throw new Error('local/central ZIP metadata mismatch');
    }
    if (
      !(entry.generalPurposeBitFlag & 8) &&
      (local.crc32 !== entry.crc32 ||
        local.compressedSize !== entry.compressedSize ||
        local.uncompressedSize !== entry.uncompressedSize)
    ) {
      throw new Error('local/central ZIP sizes or CRC mismatch');
    }
  }
  return records;
}

/**
 * Extract into a NEW destination and return hashes computed in the write stream.
 * All entries, even excluded files, consume every admission/runtime budget.
 * On rejection only our newly-created destination is removed; the ZIP is untouched.
 */
export async function extractZipManifest(zipPath, destination, options = {}) {
  const limits = comparisonLimits(options.limits);
  const admittedSize = await admitArchive(zipPath, limits);
  let zip;
  let created = false;
  const manifest = new Map();
  let total = 0;
  let processedCompressed = 0;
  try {
    zip = await openPromise(zipPath, {
      autoClose: false,
      lazyEntries: true,
      validateEntrySizes: true,
      strictFileNames: true,
    });
    within(zip.fileSize, limits.archiveBytes, 'archive bytes');
    if (zip.fileSize !== admittedSize) throw new Error('ZIP size changed during admission');
    const records = await inventory(zip, limits);
    await mkdir(destination);
    created = true;
    for (const { entry, directory, name } of records) {
      processedCompressed += entry.compressedSize;
      const target = join(destination, name);
      await mkdir(directory ? target : dirname(target), { recursive: true });
      let bytes = 0;
      let crc = 0;
      const hash = createHash('sha256');
      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          try {
            bytes += chunk.length;
            total += chunk.length;
            within(bytes, limits.entryBytes, 'actual entry bytes');
            within(total, limits.totalBytes, 'actual aggregate expanded bytes');
            if (total > processedCompressed * limits.ratio) {
              throw new Error('actual aggregate compression ratio exceeded');
            }
            if (bytes > entry.uncompressedSize || bytes > entry.compressedSize * limits.ratio) {
              throw new Error('actual entry size or compression ratio exceeded');
            }
            crc = crc32(chunk, crc);
            hash.update(chunk);
            callback(null, chunk);
          } catch (error) {
            callback(error);
          }
        },
      });
      const source = await zip.openReadStreamPromise(entry);
      const output = directory
        ? new Writable({
            write(_chunk, _encoding, done) {
              done();
            },
          })
        : createWriteStream(target, { flags: 'wx' });
      await pipeline(source, meter, output);
      if (bytes !== entry.uncompressedSize || crc >>> 0 !== entry.crc32) {
        throw new Error('ZIP entry length or CRC mismatch');
      }
      if (!directory && !options.isExcluded?.(name)) manifest.set(name, hash.digest('hex'));
    }
    return manifest;
  } catch (error) {
    if (created) await rm(destination, { recursive: true, force: true });
    throw error;
  } finally {
    zip?.close();
  }
}
