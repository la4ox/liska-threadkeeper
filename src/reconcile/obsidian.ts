import {
  CHATGPT_RECONCILIATION_BUNDLE_SCHEMA,
  CHATGPT_RECONCILIATION_DELIVERY_HARD_LIMITS,
  type ChatGptReconciliationArtifact,
  type ChatGptReconciliationArtifactPath,
  type ChatGptReconciliationDelivery,
} from '../archive/reconciliation/chatgpt-delivery';
import { CHATGPT_COMPARISON_HARD_LIMITS } from '../archive/reconciliation/chatgpt';
import { snapshotJson } from '../archive/reconciliation/chatgpt/safe-json';
import { parseWebCanonicalJson } from '../archive/reconciliation/chatgpt-delivery/json';
import { ObsidianApiClient, type ObsidianServerVersions } from '../lib/obsidian-api';
import { getDateVariables, resolvePathTemplate } from '../lib/path-utils';
import { validateObsidianUrl, validateVaultPath } from '../lib/validation';

const HASH = /^[a-f0-9]{64}$/;
const ATTEMPT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const NORMALIZED_PATHS: readonly ChatGptReconciliationArtifactPath[] = [
  'official/conversation.json',
  'official/manifest.json',
  'official/canonical/liska-thread-1.json',
  'comparison/liska-chatgpt-comparison-1.json',
  'manifest.json',
];
const RAW_ONLY_PATHS = [NORMALIZED_PATHS[0], NORMALIZED_PATHS[1], 'manifest.json'] as const;

export const OBSIDIAN_RECONCILIATION_HARD_LIMITS = Object.freeze({
  maxArtifactBytes: CHATGPT_RECONCILIATION_DELIVERY_HARD_LIMITS.maxArtifactBytes,
  maxBundleBytes: CHATGPT_RECONCILIATION_DELIVERY_HARD_LIMITS.maxBundleBytes,
  maxManifestBytes: 64 * 1024,
  requestTimeoutMs: 60_000,
});

export type ObsidianReconciliationLimits = {
  -readonly [K in keyof typeof OBSIDIAN_RECONCILIATION_HARD_LIMITS]: number;
};

export type ObsidianReconciliationFailureCode =
  | 'invalid-input'
  | 'invalid-settings'
  | 'invalid-delivery'
  | 'invalid-limits'
  | 'artifact-limit'
  | 'bundle-limit'
  | 'hash-failed'
  | 'hash-invalid'
  | 'hash-mutated'
  | 'server-info-failed'
  | 'server-unsupported'
  | 'preflight-failed'
  | 'collision'
  | 'write-unconfirmed'
  | 'readback-failed'
  | 'readback-missing'
  | 'readback-size-mismatch'
  | 'readback-hash-mismatch'
  | 'cancelled';

export interface ObsidianReconciliationReceipt {
  relativePath: ChatGptReconciliationArtifactPath;
  state: 'not-dispatched' | 'unknown' | 'confirmed';
  failureCode: ObsidianReconciliationFailureCode | null;
}

export interface ObsidianReconciliationWriteResult {
  status: 'confirmed' | 'refused' | 'partial' | 'cancelled';
  failureCode: ObsidianReconciliationFailureCode | null;
  attemptId: string | null;
  bundleId: string | null;
  conversationKey: string | null;
  receipts: ObsidianReconciliationReceipt[];
}

export interface ObsidianReconciliationClient {
  getServerVersions(timeoutMs: number): Promise<ObsidianServerVersions>;
  binaryFileExists(path: string, timeoutMs: number): Promise<boolean>;
  putBinaryFileIfAbsent(
    path: string,
    bytes: Uint8Array,
    contentType: string,
    timeoutMs: number
  ): Promise<void>;
  getBinaryFileBounded(
    path: string,
    maxBytes: number,
    timeoutMs: number
  ): Promise<Uint8Array | null>;
}

export interface WriteReconciliationToObsidianInput {
  delivery: ChatGptReconciliationDelivery;
  settings: { obsidianUrl: string; obsidianApiKey: string; vaultPath: string };
  operationAt: string;
  /** A fresh caller-generated identifier; never reused for an uncertain attempt. */
  attemptId: string;
  sha256: (bytes: Uint8Array) => Promise<string>;
  signal?: AbortSignal;
  clientFactory?: (url: string, apiKey: string) => ObsidianReconciliationClient;
  limits?: Partial<ObsidianReconciliationLimits>;
}

interface PreparedWrite {
  artifacts: ChatGptReconciliationArtifact[];
  basePath: string;
  attemptId: string;
  bundleId: string;
  conversationKey: string;
  status: 'normalized' | 'raw-only';
  manifest: unknown;
  url: string;
  apiKey: string;
  sha256: WriteReconciliationToObsidianInput['sha256'];
  signal?: AbortSignal;
  clientFactory: NonNullable<WriteReconciliationToObsidianInput['clientFactory']>;
  limits: ObsidianReconciliationLimits;
}

const INTERNAL_FAILURES = new WeakMap<object, ObsidianReconciliationFailureCode>();

function fail(code: ObsidianReconciliationFailureCode): never {
  const error = new Error('Obsidian reconciliation refused.');
  INTERNAL_FAILURES.set(error, code);
  throw error;
}

function failureCode(error: unknown): ObsidianReconciliationFailureCode {
  return typeof error === 'object' && error !== null
    ? (INTERNAL_FAILURES.get(error) ?? 'invalid-input')
    : 'invalid-input';
}

function dataRecord(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype)
    fail('invalid-input');
  const keys = Reflect.ownKeys(value);
  if (keys.length > allowed.length || keys.some(key => typeof key !== 'string'))
    fail('invalid-input');
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys as string[]) {
    if (!allowed.includes(key)) fail('invalid-input');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) fail('invalid-input');
    result[key] = descriptor.value;
  }
  return result;
}

function limitsFor(value: unknown): ObsidianReconciliationLimits {
  const limits: ObsidianReconciliationLimits = { ...OBSIDIAN_RECONCILIATION_HARD_LIMITS };
  if (value === undefined) return limits;
  const overrides = dataRecord(value, Object.keys(limits));
  for (const [key, limit] of Object.entries(overrides)) {
    const name = key as keyof ObsidianReconciliationLimits;
    if (
      typeof limit !== 'number' ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > limits[name]
    )
      fail('invalid-limits');
    limits[name] = limit;
  }
  return limits;
}

function pinnedDate(value: unknown): Date {
  if (typeof value !== 'string' || !ISO_TIME.test(value)) fail('invalid-input');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) fail('invalid-input');
  return date;
}

function safeFolder(value: string): boolean {
  if (value === '') return true;
  const control = Array.from(value).some(
    char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
  );
  if (control || value.includes('\\') || /[<>:"|?*{}%]/.test(value)) return false;
  return value.split('/').every(segment => {
    if (!segment || segment === '.' || segment === '..' || /[ .]$/.test(segment)) return false;
    return !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment);
  });
}

function settingsFor(value: unknown, date: Date) {
  try {
    const settings = dataRecord(value, ['obsidianUrl', 'obsidianApiKey', 'vaultPath']);
    if (
      typeof settings.obsidianUrl !== 'string' ||
      typeof settings.obsidianApiKey !== 'string' ||
      typeof settings.vaultPath !== 'string'
    )
      fail('invalid-settings');
    const url = validateObsidianUrl(settings.obsidianUrl);
    const apiKey = settings.obsidianApiKey.trim();
    if (
      !apiKey ||
      apiKey.length > 4096 ||
      /[\r\n]/.test(apiKey) ||
      apiKey.includes(String.fromCharCode(0))
    )
      fail('invalid-settings');
    const template = validateVaultPath(settings.vaultPath);
    const folder = resolvePathTemplate(template, {
      platform: 'chatgpt',
      ...getDateVariables(date),
    });
    if (!safeFolder(folder)) fail('invalid-settings');
    return { url, apiKey, folder };
  } catch {
    fail('invalid-settings');
  }
}

function artifactSnapshot(
  value: unknown,
  path: ChatGptReconciliationArtifactPath,
  limits: ObsidianReconciliationLimits
): ChatGptReconciliationArtifact {
  const data = dataRecord(value, ['relativePath', 'mediaType', 'byteLength', 'sha256', 'bytes']);
  if (
    data.relativePath !== path ||
    data.mediaType !== 'application/json' ||
    typeof data.sha256 !== 'string' ||
    !HASH.test(data.sha256) ||
    !ArrayBuffer.isView(data.bytes) ||
    Object.prototype.toString.call(data.bytes) !== '[object Uint8Array]'
  )
    fail('invalid-delivery');
  const bytes = data.bytes as Uint8Array;
  if (bytes.byteLength > limits.maxArtifactBytes) fail('artifact-limit');
  if (data.byteLength !== bytes.byteLength) fail('invalid-delivery');
  return {
    relativePath: path,
    mediaType: 'application/json',
    byteLength: bytes.byteLength,
    sha256: data.sha256,
    bytes,
  };
}

function manifestSnapshot(value: unknown): unknown {
  return snapshotJson(
    value,
    {
      values: 0,
      stringCodeUnits: 0,
      limits: {
        ...CHATGPT_COMPARISON_HARD_LIMITS,
        maxJsonDepth: 16,
        maxJsonValues: 10_000,
        maxJsonStringCodeUnits: 64 * 1024,
      },
    },
    () => fail('invalid-delivery')
  );
}

function artifactValues(value: unknown, expectedLength: number): unknown[] {
  if (!Array.isArray(value)) fail('invalid-delivery');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expectedLength + 1) fail('invalid-delivery');
  const length = Object.getOwnPropertyDescriptor(value, 'length');
  if (length?.value !== expectedLength) fail('invalid-delivery');
  return Array.from({ length: expectedLength }, (_, index) => {
    const entry = Object.getOwnPropertyDescriptor(value, String(index));
    if (!entry || !('value' in entry)) fail('invalid-delivery');
    return entry.value;
  });
}

function deliverySnapshot(value: unknown, limits: ObsidianReconciliationLimits) {
  const data = dataRecord(value, [
    'status',
    'failureCode',
    'conversationKey',
    'bundleId',
    'artifacts',
    'manifest',
  ]);
  if (
    (data.status !== 'normalized' && data.status !== 'raw-only') ||
    data.failureCode !== (data.status === 'normalized' ? null : 'official-normalization-failed') ||
    typeof data.bundleId !== 'string' ||
    !HASH.test(data.bundleId) ||
    typeof data.conversationKey !== 'string' ||
    !HASH.test(data.conversationKey)
  )
    fail('invalid-delivery');
  const paths = data.status === 'normalized' ? NORMALIZED_PATHS : RAW_ONLY_PATHS;
  const suppliedArtifacts = artifactValues(data.artifacts, paths.length);
  let total = 0;
  const artifacts = paths.map((path, index) => {
    const artifact = artifactSnapshot(suppliedArtifacts[index], path, limits);
    total += artifact.byteLength;
    if (total > limits.maxBundleBytes) fail('bundle-limit');
    return artifact;
  });
  const root = artifacts[artifacts.length - 1];
  if (root.byteLength > limits.maxManifestBytes) fail('artifact-limit');
  if (root.sha256 !== data.bundleId) fail('invalid-delivery');
  return {
    artifacts: artifacts.map(artifact => ({ ...artifact, bytes: new Uint8Array(artifact.bytes) })),
    bundleId: data.bundleId,
    conversationKey: data.conversationKey,
    status: data.status as PreparedWrite['status'],
    manifest: manifestSnapshot(data.manifest),
  };
}

function prepare(input: WriteReconciliationToObsidianInput): PreparedWrite {
  const data = dataRecord(input, [
    'delivery',
    'settings',
    'operationAt',
    'attemptId',
    'sha256',
    'signal',
    'clientFactory',
    'limits',
  ]);
  if (
    typeof data.attemptId !== 'string' ||
    !ATTEMPT.test(data.attemptId) ||
    /[ .]$/.test(data.attemptId) ||
    typeof data.sha256 !== 'function' ||
    (data.clientFactory !== undefined && typeof data.clientFactory !== 'function')
  )
    fail('invalid-input');
  const limits = limitsFor(data.limits);
  const settings = settingsFor(data.settings, pinnedDate(data.operationAt));
  const delivery = deliverySnapshot(data.delivery, limits);
  return {
    ...delivery,
    ...settings,
    attemptId: data.attemptId,
    basePath: [
      settings.folder,
      '_liska-reconciliation',
      delivery.conversationKey,
      delivery.bundleId,
      data.attemptId,
    ]
      .filter(Boolean)
      .join('/'),
    sha256: data.sha256 as PreparedWrite['sha256'],
    signal: data.signal as AbortSignal | undefined,
    clientFactory:
      (data.clientFactory as PreparedWrite['clientFactory'] | undefined) ??
      ((url, key) => new ObsidianApiClient(url, key)),
    limits,
  };
}

async function safeHash(prepared: PreparedWrite, bytes: Uint8Array): Promise<string> {
  const owned = new Uint8Array(bytes);
  const before = new Uint8Array(owned);
  let digest: unknown;
  try {
    digest = await prepared.sha256(owned);
  } catch {
    fail('hash-failed');
  }
  if (owned.length !== before.length || owned.some((value, index) => value !== before[index]))
    fail('hash-mutated');
  if (typeof digest !== 'string' || !HASH.test(digest)) fail('hash-invalid');
  return digest;
}

function descriptor(artifact: ChatGptReconciliationArtifact) {
  const { relativePath, mediaType, byteLength, sha256 } = artifact;
  return { relativePath, mediaType, byteLength, sha256 };
}

async function verifyDelivery(prepared: PreparedWrite): Promise<void> {
  for (const artifact of prepared.artifacts) {
    if ((await safeHash(prepared, artifact.bytes)) !== artifact.sha256) fail('invalid-delivery');
  }
  const root = prepared.artifacts[prepared.artifacts.length - 1];
  let manifest: unknown;
  try {
    manifest = parseWebCanonicalJson(root.bytes, 16, 10_000, () => fail('invalid-delivery'));
  } catch {
    fail('invalid-delivery');
  }
  if (JSON.stringify(manifest) !== JSON.stringify(prepared.manifest)) fail('invalid-delivery');
  const data = dataRecord(manifest, [
    'schema',
    'status',
    'failureCode',
    'webCanonical',
    'official',
    'artifacts',
    'warnings',
  ]);
  if (
    data.schema !== CHATGPT_RECONCILIATION_BUNDLE_SCHEMA ||
    data.status !== prepared.status ||
    data.failureCode !==
      (prepared.status === 'normalized' ? null : 'official-normalization-failed') ||
    JSON.stringify(data.artifacts) !==
      JSON.stringify(prepared.artifacts.slice(0, -1).map(descriptor))
  )
    fail('invalid-delivery');
}

function supportedServer(versions: ObsidianServerVersions): boolean {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(versions.self);
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) return false;
  return major > 5 || (major === 5 && minor >= 5);
}

function checkCancelled(prepared: PreparedWrite): void {
  if (prepared.signal?.aborted) fail('cancelled');
}

async function admitServer(prepared: PreparedWrite, client: ObsidianReconciliationClient) {
  checkCancelled(prepared);
  let versions: ObsidianServerVersions;
  try {
    versions = await client.getServerVersions(prepared.limits.requestTimeoutMs);
  } catch {
    fail('server-info-failed');
  }
  checkCancelled(prepared);
  if (!versions || !supportedServer(versions)) fail('server-unsupported');
}

function isCollision(error: unknown): boolean {
  try {
    return (
      typeof error === 'object' &&
      error !== null &&
      Object.getOwnPropertyDescriptor(error, 'status')?.value === 412
    );
  } catch {
    return false;
  }
}

function writePath(prepared: PreparedWrite, artifact: ChatGptReconciliationArtifact): string {
  return `${prepared.basePath}/${artifact.relativePath}`;
}

async function preflight(prepared: PreparedWrite, client: ObsidianReconciliationClient) {
  for (const artifact of prepared.artifacts) {
    checkCancelled(prepared);
    let exists: boolean;
    try {
      exists = await client.binaryFileExists(
        writePath(prepared, artifact),
        prepared.limits.requestTimeoutMs
      );
    } catch {
      fail('preflight-failed');
    }
    checkCancelled(prepared);
    if (exists !== false) fail(exists === true ? 'collision' : 'preflight-failed');
  }
}

async function readback(
  prepared: PreparedWrite,
  client: ObsidianReconciliationClient,
  artifact: ChatGptReconciliationArtifact
): Promise<void> {
  checkCancelled(prepared);
  let bytes: Uint8Array | null;
  try {
    bytes = await client.getBinaryFileBounded(
      writePath(prepared, artifact),
      artifact.byteLength,
      prepared.limits.requestTimeoutMs
    );
  } catch {
    fail('readback-failed');
  }
  checkCancelled(prepared);
  if (bytes === null) fail('readback-missing');
  if (!ArrayBuffer.isView(bytes) || Object.prototype.toString.call(bytes) !== '[object Uint8Array]')
    fail('readback-failed');
  if (bytes.byteLength !== artifact.byteLength) fail('readback-size-mismatch');
  if ((await safeHash(prepared, bytes)) !== artifact.sha256) fail('readback-hash-mismatch');
  checkCancelled(prepared);
}

async function writeArtifact(
  prepared: PreparedWrite,
  client: ObsidianReconciliationClient,
  artifact: ChatGptReconciliationArtifact,
  receipt: ObsidianReconciliationReceipt
): Promise<void> {
  checkCancelled(prepared);
  receipt.state = 'unknown';
  try {
    await client.putBinaryFileIfAbsent(
      writePath(prepared, artifact),
      new Uint8Array(artifact.bytes),
      'application/octet-stream',
      prepared.limits.requestTimeoutMs
    );
  } catch (error) {
    if (isCollision(error)) {
      receipt.state = 'not-dispatched';
      fail('collision');
    }
    fail('write-unconfirmed');
  }
  await readback(prepared, client, artifact);
  receipt.state = 'confirmed';
}

function resultFor(prepared: PreparedWrite | undefined): ObsidianReconciliationWriteResult {
  return {
    status: 'refused',
    failureCode: null,
    attemptId: prepared?.attemptId ?? null,
    bundleId: prepared?.bundleId ?? null,
    conversationKey: prepared?.conversationKey ?? null,
    receipts:
      prepared?.artifacts.map(artifact => ({
        relativePath: artifact.relativePath,
        state: 'not-dispatched',
        failureCode: null,
      })) ?? [],
  };
}

/** Direct extension-page-only create/readback flow. No runtime messaging, retries or deletion. */
export async function writeReconciliationToObsidian(
  input: WriteReconciliationToObsidianInput
): Promise<ObsidianReconciliationWriteResult> {
  let prepared: PreparedWrite | undefined;
  let result = resultFor(undefined);
  let currentReceipt: ObsidianReconciliationReceipt | undefined;
  try {
    prepared = prepare(input);
    result = resultFor(prepared);
    checkCancelled(prepared);
    await verifyDelivery(prepared);
    checkCancelled(prepared);
    const client = prepared.clientFactory(prepared.url, prepared.apiKey);
    await admitServer(prepared, client);
    await preflight(prepared, client);
    for (let index = 0; index < prepared.artifacts.length; index += 1) {
      currentReceipt = result.receipts[index];
      await writeArtifact(prepared, client, prepared.artifacts[index], currentReceipt);
    }
    result.status = 'confirmed';
    return result;
  } catch (error) {
    const code = failureCode(error);
    result.failureCode = code;
    if (currentReceipt) currentReceipt.failureCode = code;
    const dispatched = result.receipts.some(receipt => receipt.state !== 'not-dispatched');
    result.status = dispatched ? 'partial' : code === 'cancelled' ? 'cancelled' : 'refused';
    return result;
  }
}
