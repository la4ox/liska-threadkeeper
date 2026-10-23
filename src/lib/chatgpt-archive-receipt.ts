/** Destination-owned evidence for the archive bytes safe to link from a note. */
import { binaryAssetExtension } from './binary-asset-contract';
import type { PersistentOutputDestination } from './types';

export interface ChatGptArchivedAssetReceipt {
  sha256: string;
  relativePath: string;
  mediaType: string;
  byteLength: number;
}

export interface ChatGptDestinationArchiveReceipt {
  destination: PersistentOutputDestination;
  captureId: string;
  conversationKey: string;
  manifestSha256: string;
  assets: ChatGptArchivedAssetReceipt[];
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CAPTURE_ID_PATTERN = /^capture-chatgpt-[A-Za-z0-9][A-Za-z0-9_-]{0,239}$/;
const RECEIPT_KEYS = ['destination', 'captureId', 'conversationKey', 'manifestSha256', 'assets'];
const ASSET_KEYS = ['sha256', 'relativePath', 'mediaType', 'byteLength'];

/** Read descriptors, never values through a possibly accessor-backed property. */
function ownPlainData(
  value: unknown,
  expected: readonly string[]
): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expected.length ||
    keys.some(key => typeof key !== 'string' || !expected.includes(key))
  ) {
    return undefined;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const snapshot: Record<string, unknown> = Object.create(null);
  for (const key of expected) {
    const descriptor = descriptors[key];
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return undefined;
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function ownArrayData(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const length: unknown = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) return undefined;
  if (Reflect.ownKeys(value).length !== length + 1) return undefined;
  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return undefined;
    snapshot.push(descriptor.value);
  }
  return snapshot;
}

function snapshotAsset(value: unknown): ChatGptArchivedAssetReceipt | undefined {
  const asset = ownPlainData(value, ASSET_KEYS);
  if (!asset || typeof asset.sha256 !== 'string' || !SHA256_PATTERN.test(asset.sha256))
    return undefined;
  if (typeof asset.mediaType !== 'string' || asset.mediaType !== asset.mediaType.toLowerCase())
    return undefined;
  const extension = binaryAssetExtension(asset.mediaType);
  if (typeof extension !== 'string' || asset.relativePath !== `assets/${asset.sha256}.${extension}`)
    return undefined;
  if (
    typeof asset.byteLength !== 'number' ||
    !Number.isSafeInteger(asset.byteLength) ||
    asset.byteLength < 0
  )
    return undefined;
  return {
    sha256: asset.sha256,
    relativePath: asset.relativePath,
    mediaType: asset.mediaType,
    byteLength: asset.byteLength,
  };
}

/**
 * Fail closed on malformed/non-JSON-like data and detach every accepted value
 * from its input. No provider identifiers, names, URLs, or statuses are admitted.
 */
export function snapshotChatGptDestinationArchiveReceipt(
  value: unknown
): ChatGptDestinationArchiveReceipt | undefined {
  try {
    const receipt = ownPlainData(value, RECEIPT_KEYS);
    if (!receipt || (receipt.destination !== 'file' && receipt.destination !== 'obsidian'))
      return undefined;
    if (typeof receipt.captureId !== 'string' || !CAPTURE_ID_PATTERN.test(receipt.captureId))
      return undefined;
    if (
      typeof receipt.conversationKey !== 'string' ||
      !SHA256_PATTERN.test(receipt.conversationKey)
    )
      return undefined;
    if (typeof receipt.manifestSha256 !== 'string' || !SHA256_PATTERN.test(receipt.manifestSha256))
      return undefined;
    const values = ownArrayData(receipt.assets);
    if (!values) return undefined;
    const assets: ChatGptArchivedAssetReceipt[] = [];
    const targets = new Set<string>();
    for (const value of values) {
      const asset = snapshotAsset(value);
      if (!asset || targets.has(asset.relativePath)) return undefined;
      targets.add(asset.relativePath);
      assets.push(asset);
    }
    return {
      destination: receipt.destination,
      captureId: receipt.captureId,
      conversationKey: receipt.conversationKey,
      manifestSha256: receipt.manifestSha256,
      assets,
    };
  } catch {
    return undefined;
  }
}

export function isChatGptDestinationArchiveReceipt(
  value: unknown
): value is ChatGptDestinationArchiveReceipt {
  return snapshotChatGptDestinationArchiveReceipt(value) !== undefined;
}
