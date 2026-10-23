/** Presentation-only sandbox links. No provider requests or durable archive edits. */
import {
  buildCaptureManifest,
  type ArchiveMessage,
  type LiskaThreadArchive,
  type RawCaptureAssetRecord,
  type RawCaptureManifest,
  type SourceReference,
  type TextBlock,
} from '../archive';
import {
  chatGptAssetIdForIdentity,
  chatGptSandboxLinkOccurrencesFromAssistantTextPart,
  type ChatGptSandboxLinkOccurrence,
} from '../archive/chatgpt-sandbox-link';
import {
  snapshotChatGptDestinationArchiveReceipt,
  type ChatGptDestinationArchiveReceipt,
} from '../lib/chatgpt-archive-receipt';
import { canonicalBase64ByteLength } from '../lib/base64';
import { MAX_CONTENT_SIZE } from '../lib/constants';
import {
  ARCHIVE_COMPANION_RELATIVE_PATHS,
  type ArchiveCompanionBundle,
  type ChatGptStructuredPresentationContext,
  type ConversationData,
  type PersistentOutputDestination,
} from '../lib/types';
import { projectArchiveBranch, projectArchiveMessageVisibleContent } from './archive-projection';
import { verifyChatGptAssetExportContext } from './capture/chatgpt-current-branch';
import { sha256Hex } from './capture/response';

interface ArtifactIdentity {
  relativePath: string;
  mediaType: string;
  byteLength: number;
  sha256: string;
}

/** Detached runtime evidence only. This must not enter messages, logs, or archives. */
export interface ChatGptSandboxLocalizationEvidence {
  readonly receipt: ChatGptDestinationArchiveReceipt;
  readonly conversationId: string;
  readonly raw: ArtifactIdentity;
  readonly canonical: ArtifactIdentity;
  /** Whole finalized ledger, including failed/nonfetched records and every sourceRef. */
  readonly records: readonly RawCaptureAssetRecord[];
  /** Detect drift of the detached runtime snapshot after finalization awaits. */
  readonly snapshotSha256: string;
}

type EvidencePayload = Omit<ChatGptSandboxLocalizationEvidence, 'snapshotSha256'>;

const jsonBytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
const shaPattern = /^[a-f0-9]{64}$/;
const assetIdPattern = /^chatgpt-asset-[a-f0-9]{64}$/;

function artifactIdentity(value: ArtifactIdentity): ArtifactIdentity {
  return {
    relativePath: value.relativePath,
    mediaType: value.mediaType,
    byteLength: value.byteLength,
    sha256: value.sha256,
  };
}

function validArtifact(value: ArtifactIdentity, kind: 'raw' | 'canonical'): boolean {
  return (
    value.relativePath === ARCHIVE_COMPANION_RELATIVE_PATHS[kind] &&
    value.mediaType === 'application/json' &&
    shaPattern.test(value.sha256) &&
    Number.isSafeInteger(value.byteLength) &&
    value.byteLength > 0
  );
}

function matchingFinalArtifacts(
  receipt: ChatGptDestinationArchiveReceipt,
  raw: ArtifactIdentity,
  canonical: ArtifactIdentity,
  manifest: RawCaptureManifest
): boolean {
  return (
    validArtifact(canonical, 'canonical') &&
    validArtifact(raw, 'raw') &&
    receipt.archiveByteLengths.raw === raw.byteLength &&
    receipt.archiveByteLengths.canonical === canonical.byteLength &&
    manifest.artifacts.length === 1 &&
    JSON.stringify(raw) === JSON.stringify(artifactIdentity(manifest.artifacts[0]))
  );
}

function decodeManifest(companion: ArchiveCompanionBundle):
  | {
      bytes: Uint8Array;
      descriptor: ArtifactIdentity;
      manifest: RawCaptureManifest;
    }
  | undefined {
  const artifacts = companion.artifacts.filter(artifact => artifact.kind === 'manifest');
  const artifact = artifacts[0];
  if (
    artifacts.length !== 1 ||
    artifact.transport !== 'inline' ||
    artifact.byteLength > MAX_CONTENT_SIZE ||
    artifact.relativePath !== ARCHIVE_COMPANION_RELATIVE_PATHS.manifest ||
    canonicalBase64ByteLength(artifact.bodyBase64) !== artifact.byteLength
  )
    return undefined;
  const binary = atob(artifact.bodyBase64);
  if (btoa(binary) !== artifact.bodyBase64) return undefined;
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const manifest = buildCaptureManifest(parsed);
  if (parsed.schema !== manifest.schema) return undefined;
  return { bytes, descriptor: artifactIdentity(artifact), manifest };
}

/**
 * Snapshot the exact final manifest before persistence awaits. The caller exposes
 * this evidence only after that destination's manifest AND canonical writes succeed.
 * Invalid evidence is optional: it must never turn an existing export into failure.
 */
export async function buildChatGptSandboxLocalizationEvidence(
  companion: ArchiveCompanionBundle,
  value: ChatGptDestinationArchiveReceipt
): Promise<ChatGptSandboxLocalizationEvidence | undefined> {
  try {
    const receipt = snapshotChatGptDestinationArchiveReceipt(value);
    const decoded = decodeManifest(companion);
    const canonicalArtifacts = companion.artifacts.filter(
      artifact => artifact.kind === 'canonical'
    );
    const rawArtifacts = companion.artifacts.filter(artifact => artifact.kind === 'raw');
    if (!receipt || !decoded || canonicalArtifacts.length !== 1 || rawArtifacts.length !== 1)
      return undefined;
    const canonical = artifactIdentity(canonicalArtifacts[0]);
    const raw = artifactIdentity(rawArtifacts[0]);
    const { manifest, descriptor, bytes } = decoded;
    if (
      !matchingFinalArtifacts(receipt, raw, canonical, manifest) ||
      receipt.captureId !== companion.captureId ||
      receipt.conversationKey !== companion.conversationKey ||
      manifest.provider !== 'chatgpt' ||
      manifest.captureId !== receipt.captureId ||
      receipt.manifestSha256 !== descriptor.sha256 ||
      receipt.archiveByteLengths.manifest !== bytes.length
    )
      return undefined;
    const payload: EvidencePayload = {
      receipt,
      conversationId: manifest.conversationId,
      raw,
      canonical,
      records: manifest.assets,
    };
    // Construct serialization synchronously: both it and the parsed ledger are
    // detached from companion/receipt inputs before the first digest await.
    const snapshotBytes = jsonBytes(payload);
    if (
      (await sha256Hex(bytes)) !== descriptor.sha256 ||
      (await sha256Hex(new TextEncoder().encode(payload.conversationId))) !==
        receipt.conversationKey
    )
      return undefined;
    return { ...payload, snapshotSha256: await sha256Hex(snapshotBytes) };
  } catch {
    return undefined;
  }
}

function own(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

/** Exact bounded JSON pointers only; no inherited properties or recursive search. */
function pointerSegments(pointer: string): string[] | undefined {
  if (
    pointer.length > 4096 ||
    !pointer.startsWith('/') ||
    Array.from(pointer).some(character => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  )
    return undefined;
  const encoded = pointer.slice(1).split('/');
  if (encoded.length > 8 || encoded.some(segment => /~(?![01])/u.test(segment))) return undefined;
  return encoded.map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function atSegments(raw: unknown, segments: readonly string[]): unknown {
  return segments.reduce<unknown>((value, key) => own(value, key), raw);
}

interface ProvenPart {
  nodeId: string;
  blockIndex: number;
  block: TextBlock;
  pointer: string;
  occurrences: readonly ChatGptSandboxLinkOccurrence[];
}

function exactSource(
  refs: readonly SourceReference[],
  kind: string,
  id: string,
  pointer: string
): boolean {
  return (
    refs.length === 1 &&
    refs[0].format === 'chatgpt.web.history' &&
    refs[0].kind === kind &&
    refs[0].id === id &&
    refs[0].artifactId === 'conversation' &&
    refs[0].rawPointer === pointer
  );
}

function directPartLocation(
  pointer: string,
  nodeId: string
): { segments: string[]; nodeSegments: string[]; nodePointer: string } | undefined {
  const segments = pointerSegments(pointer);
  if (!segments) return undefined;
  const offset = segments[0] === 'conversation' ? 1 : 0;
  if (
    segments.length !== 6 + offset ||
    segments[offset] !== 'mapping' ||
    segments[1 + offset] !== nodeId ||
    segments[2 + offset] !== 'message' ||
    segments[3 + offset] !== 'content' ||
    segments[4 + offset] !== 'parts' ||
    !/^(?:0|[1-9][0-9]{0,8})$/.test(segments[5 + offset])
  )
    return undefined;
  return {
    segments,
    nodeSegments: segments.slice(0, 2 + offset),
    nodePointer: pointer.slice(0, pointer.lastIndexOf('/message/')),
  };
}

function rawPartMatches(
  raw: unknown,
  location: NonNullable<ReturnType<typeof directPartLocation>>,
  nodeId: string,
  messageId: string,
  text: string
): boolean {
  const rawNode = atSegments(raw, location.nodeSegments);
  const rawMessage = own(rawNode, 'message');
  const content = own(rawMessage, 'content');
  return (
    own(rawNode, 'id') === nodeId &&
    own(rawMessage, 'id') === messageId &&
    own(own(rawMessage, 'author'), 'role') === 'assistant' &&
    own(content, 'content_type') === 'text' &&
    Array.isArray(own(content, 'parts')) &&
    atSegments(raw, location.segments) === text
  );
}

/** A direct assistant text part only. Nested objects and all other block types are unsupported. */
function provePart(
  raw: unknown,
  archive: LiskaThreadArchive,
  nodeId: string,
  blockIndex: number
): ProvenPart | undefined {
  const node = archive.graph.nodes[nodeId];
  const message = node.message;
  const block = message?.blocks[blockIndex];
  if (
    !message ||
    message.author.role !== 'assistant' ||
    block?.type !== 'text' ||
    block.sourceRefs.length !== 1
  )
    return undefined;
  const pointer = block.sourceRefs[0].rawPointer;
  if (
    typeof pointer !== 'string' ||
    !exactSource(block.sourceRefs, 'content-part', message.id, pointer)
  )
    return undefined;
  const location = directPartLocation(pointer, nodeId);
  if (!location) return undefined;
  const { nodePointer } = location;
  const messagePointer = `${nodePointer}/message`;
  if (
    !exactSource(node.sourceRefs, 'node', nodeId, nodePointer) ||
    !exactSource(message.sourceRefs, 'message', message.id, messagePointer)
  )
    return undefined;
  if (!rawPartMatches(raw, location, nodeId, message.id, block.text)) return undefined;
  return {
    nodeId,
    blockIndex,
    block,
    pointer,
    occurrences: chatGptSandboxLinkOccurrencesFromAssistantTextPart(message.id, block.text),
  };
}

/** Every ID is indexed before state filtering; never first-wins or truncated. */
function wholeLedger(
  records: readonly RawCaptureAssetRecord[]
): Map<string, RawCaptureAssetRecord> {
  const result = new Map<string, RawCaptureAssetRecord>();
  for (const record of records) {
    if (
      !assetIdPattern.test(record.id) ||
      result.has(record.id) ||
      !Array.isArray(record.sourceRefs)
    )
      throw new Error('invalid-ledger');
    result.set(record.id, record);
  }
  return result;
}

function sourceKey(ref: { artifactId: string; rawPointer: string }): string {
  return JSON.stringify([ref.artifactId, ref.rawPointer]);
}

function recordSourceKeys(record: RawCaptureAssetRecord): Set<string> {
  const keys = new Set(record.sourceRefs.map(sourceKey));
  if (keys.size !== record.sourceRefs.length) throw new Error('ambiguous-source');
  return keys;
}

interface LocalTarget {
  target: string;
  sourceKeys: ReadonlySet<string>;
}

/** Linear whole-ledger/receipt join; each occurrence later needs only O(1) lookup. */
function localizationTargets(
  original: readonly RawCaptureAssetRecord[],
  evidence: EvidencePayload
): Map<string, LocalTarget> {
  const initial = wholeLedger(original);
  const final = wholeLedger(evidence.records);
  if (initial.size !== final.size || [...initial.keys()].some(id => !final.has(id)))
    throw new Error('ledger-drift');
  // The receipt snapshot validator already rejected duplicate destination paths.
  const tuples = new Map(evidence.receipt.assets.map(asset => [asset.relativePath, asset]));
  const targets = new Map<string, LocalTarget>();
  for (const [id, record] of final) {
    const initialSources = recordSourceKeys(initial.get(id)!);
    const finalSources = recordSourceKeys(record);
    if (
      record.state !== 'fetched' ||
      record.relativePath === null ||
      initialSources.size !== finalSources.size ||
      [...initialSources].some(source => !finalSources.has(source))
    )
      continue;
    const tuple = tuples.get(record.relativePath);
    if (
      !tuple ||
      tuple.sha256 !== record.sha256 ||
      tuple.byteLength !== record.byteLength ||
      tuple.mediaType !== record.mediaType
    )
      continue;
    targets.set(id, {
      sourceKeys: finalSources,
      target: `_liska-archive/${evidence.receipt.conversationKey}/${evidence.receipt.captureId}/${tuple.relativePath}`,
    });
  }
  return targets;
}

interface CanonicalSourceCounts {
  pointers: Map<string, number>;
  messageIds: Map<string, number>;
}

function canonicalSourceCounts(archive: LiskaThreadArchive): CanonicalSourceCounts {
  const pointers = new Map<string, number>();
  const messageIds = new Map<string, number>();
  for (const node of Object.values(archive.graph.nodes)) {
    const message = node.message;
    if (!message) continue;
    messageIds.set(message.id, (messageIds.get(message.id) ?? 0) + 1);
    for (const block of message.blocks)
      for (const ref of block.sourceRefs) {
        if (ref.artifactId !== 'conversation' || ref.rawPointer === null) continue;
        pointers.set(ref.rawPointer, (pointers.get(ref.rawPointer) ?? 0) + 1);
      }
  }
  return { pointers, messageIds };
}

function provenMessageParts(
  raw: unknown,
  archive: LiskaThreadArchive,
  nodeId: string,
  message: ArchiveMessage,
  counts: CanonicalSourceCounts
): ProvenPart[] {
  const parts: ProvenPart[] = [];
  for (let index = 0; index < message.blocks.length; index += 1) {
    const part = provePart(raw, archive, nodeId, index);
    if (part && counts.pointers.get(part.pointer) === 1) parts.push(part);
  }
  return parts;
}

function occurrenceKey(identity: string, destination: string, start: number, end: number): string {
  return JSON.stringify([identity, destination, start, end]);
}

function localOccurrenceKey(part: ProvenPart, occurrence: ChatGptSandboxLinkOccurrence): string {
  return JSON.stringify([
    part.blockIndex,
    occurrence.identity,
    occurrence.destination,
    occurrence.destinationStart,
    occurrence.destinationEnd,
  ]);
}

function presentationSafeOccurrences(
  message: ArchiveMessage,
  renderedContent: string,
  parts: readonly ProvenPart[]
): ReadonlySet<string> {
  const layout = projectArchiveMessageVisibleContent(message);
  if (layout.content !== renderedContent) return new Set();
  const renderedOccurrences = new Set(
    chatGptSandboxLinkOccurrencesFromAssistantTextPart(message.id, renderedContent).map(
      occurrence =>
        occurrenceKey(
          occurrence.identity,
          occurrence.destination,
          occurrence.destinationStart,
          occurrence.destinationEnd
        )
    )
  );
  const spans = new Map(layout.textBlockSpans.map(span => [span.blockIndex, span] as const));
  const safe = new Set<string>();
  for (const part of parts) {
    const span = spans.get(part.blockIndex);
    if (!span || span.end - span.start !== part.block.text.length) continue;
    for (const occurrence of part.occurrences) {
      const absolute = occurrenceKey(
        occurrence.identity,
        occurrence.destination,
        span.start + occurrence.destinationStart,
        span.start + occurrence.destinationEnd
      );
      if (renderedOccurrences.has(absolute)) safe.add(localOccurrenceKey(part, occurrence));
    }
  }
  return safe;
}

async function localizedPartText(
  part: ProvenPart,
  presentationSafe: ReadonlySet<string>,
  targets: ReadonlyMap<string, LocalTarget>,
  identityIds: Map<string, string | undefined>
): Promise<string | undefined> {
  const edits: Array<{ occurrence: ChatGptSandboxLinkOccurrence; target: string }> = [];
  for (const occurrence of part.occurrences) {
    if (!presentationSafe.has(localOccurrenceKey(part, occurrence))) continue;
    if (!identityIds.has(occurrence.identity))
      identityIds.set(
        occurrence.identity,
        await chatGptAssetIdForIdentity(occurrence.identity, sha256Hex)
      );
    const id = identityIds.get(occurrence.identity);
    if (!id) continue;
    const target = targets.get(id);
    if (target?.sourceKeys.has(sourceKey({ artifactId: 'conversation', rawPointer: part.pointer })))
      edits.push({ occurrence, target: target.target });
  }
  if (edits.length === 0) return undefined;
  const chunks: string[] = [];
  let cursor = part.block.text.length;
  for (const { occurrence, target } of edits.reverse()) {
    chunks.push(part.block.text.slice(occurrence.destinationEnd, cursor), target);
    cursor = occurrence.destinationStart;
  }
  chunks.push(part.block.text.slice(0, cursor));
  return chunks.reverse().join('');
}

async function replacementsForBranch(
  raw: unknown,
  context: ChatGptStructuredPresentationContext,
  evidence: EvidencePayload,
  originalRecords: readonly RawCaptureAssetRecord[],
  projectedData: ConversationData
): Promise<Map<string, Map<number, string>>> {
  const targets = localizationTargets(originalRecords, evidence);
  const counts = canonicalSourceCounts(context.archive);
  const projectedContent = new Map(
    projectedData.messages.map(message => [message.id, message.content] as const)
  );
  const replacements = new Map<string, Map<number, string>>();
  const identityIds = new Map<string, string | undefined>();
  for (const nodeId of context.selectedNodeIds) {
    const message = context.archive.graph.nodes[nodeId].message;
    if (!message || counts.messageIds.get(message.id) !== 1) continue;
    const renderedContent = projectedContent.get(message.id);
    if (renderedContent === undefined) continue;
    const parts = provenMessageParts(raw, context.archive, nodeId, message, counts);
    const presentationSafe = presentationSafeOccurrences(message, renderedContent, parts);
    for (const part of parts) {
      const text = await localizedPartText(part, presentationSafe, targets, identityIds);
      if (text === undefined) continue;
      if (!replacements.has(nodeId)) replacements.set(nodeId, new Map());
      replacements.get(nodeId)!.set(part.blockIndex, text);
    }
  }
  return replacements;
}

function changedArchive(
  archive: LiskaThreadArchive,
  replacements: Map<string, Map<number, string>>
): LiskaThreadArchive {
  const nodes = { ...archive.graph.nodes };
  for (const [nodeId, blocks] of replacements) {
    const node = nodes[nodeId];
    const message = node.message!;
    nodes[nodeId] = {
      ...node,
      message: {
        ...message,
        blocks: message.blocks.map((block, index) =>
          block.type === 'text' && blocks.has(index)
            ? { ...block, text: blocks.get(index)! }
            : block
        ),
      },
    };
  }
  return { ...archive, graph: { ...archive.graph, nodes } };
}

function presentationMatches(
  data: ConversationData,
  context: ChatGptStructuredPresentationContext
): boolean {
  return (
    data.source === 'chatgpt' &&
    data.capture?.mode === 'structured-api' &&
    data.capture.completeness === 'complete' &&
    data.id === context.assetExportContext.conversationId &&
    (!data.presentation ||
      (data.presentation.mode === 'selected-branch' &&
        data.presentation.captureId === context.captureId))
  );
}

async function boundEvidence(
  value: ChatGptSandboxLocalizationEvidence,
  receiptValue: unknown,
  destination: PersistentOutputDestination,
  context: ChatGptStructuredPresentationContext
): Promise<EvidencePayload | undefined> {
  // Detach once before any await; later mutations cannot change the accepted plan.
  const snapshot = structuredClone(value);
  const receipt = snapshotChatGptDestinationArchiveReceipt(snapshot.receipt);
  const actualReceipt = snapshotChatGptDestinationArchiveReceipt(receiptValue);
  if (
    !receipt ||
    !actualReceipt ||
    JSON.stringify(receipt) !== JSON.stringify(actualReceipt) ||
    receipt.destination !== destination ||
    receipt.captureId !== context.captureId ||
    receipt.conversationKey !== context.conversationKey ||
    snapshot.conversationId !== context.assetExportContext.conversationId ||
    !validArtifact(snapshot.canonical, 'canonical') ||
    !validArtifact(snapshot.raw, 'raw') ||
    snapshot.canonical.byteLength !== receipt.archiveByteLengths.canonical ||
    snapshot.raw.byteLength !== receipt.archiveByteLengths.raw
  )
    return undefined;
  const { snapshotSha256, ...payload } = snapshot;
  if ((await sha256Hex(jsonBytes(payload))) !== snapshotSha256) return undefined;
  return { ...payload, receipt };
}

async function verifiedLocalizationRaw(
  context: ChatGptStructuredPresentationContext,
  bound: EvidencePayload,
  conversationId: string
): Promise<{ raw: unknown; originalRecords: RawCaptureAssetRecord[] } | undefined> {
  const original = await verifyChatGptAssetExportContext(context.assetExportContext);
  const rawBytes = new Uint8Array(original.bytes);
  const manifestJson = JSON.stringify(
    context.assetExportContext.rawCaptureBundle.manifest,
    null,
    2
  );
  if (
    JSON.stringify(artifactIdentity(original.record)) !== JSON.stringify(bound.raw) ||
    context.assetExportContext.rawCaptureBundle.manifest.captureId !== context.captureId ||
    rawBytes.byteLength !== bound.raw.byteLength ||
    (await sha256Hex(rawBytes)) !== bound.raw.sha256 ||
    (await sha256Hex(new TextEncoder().encode(manifestJson))) !== context.manifestSha256 ||
    (await sha256Hex(new TextEncoder().encode(conversationId))) !== context.conversationKey ||
    context.archive.inputs.length !== 1 ||
    context.archive.inputs[0].captureId !== context.captureId ||
    context.archive.inputs[0].manifestSha256 !== context.manifestSha256
  )
    return undefined;
  const originalManifest = JSON.parse(manifestJson) as RawCaptureManifest;
  return {
    raw: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBytes)),
    originalRecords: originalManifest.assets,
  };
}

/** Fail-soft pure derivation. Only accepted destination spans change, never source objects. */
export async function localizeChatGptSandboxLinks(
  data: ConversationData,
  context: ChatGptStructuredPresentationContext | undefined,
  evidence: ChatGptSandboxLocalizationEvidence | undefined,
  receipt: unknown,
  destination: PersistentOutputDestination
): Promise<ConversationData> {
  try {
    if (!context || !evidence || !presentationMatches(data, context)) return data;
    const initialJson = JSON.stringify(context.archive, null, 2);
    const initialBytes = new TextEncoder().encode(initialJson);
    if (
      !validArtifact(context.canonical, 'canonical') ||
      initialBytes.byteLength !== context.canonical.byteLength ||
      (await sha256Hex(initialBytes)) !== context.canonical.sha256
    )
      return data;
    const bound = await boundEvidence(evidence, receipt, destination, context);
    if (!bound) return data;
    const verified = await verifiedLocalizationRaw(context, bound, data.id);
    if (!verified) return data;
    const options = {
      targetNodeId: context.targetNodeId,
      includeToolContent: context.includeToolContent,
    };
    const projected = projectArchiveBranch(context.archive, options);
    if (
      JSON.stringify(projected.selectedNodeIds) !== JSON.stringify(context.selectedNodeIds) ||
      JSON.stringify(projected.data.messages) !== JSON.stringify(data.messages)
    )
      return data;
    const replacements = await replacementsForBranch(
      verified.raw,
      context,
      bound,
      verified.originalRecords,
      projected.data
    );
    // Archive is retained by reference. A post-await identity check rejects drift
    // before constructing the small copy-on-write view or invoking projection.
    if (
      replacements.size === 0 ||
      JSON.stringify(context.archive, null, 2) !== initialJson ||
      JSON.stringify(projected.data.messages) !== JSON.stringify(data.messages)
    )
      return data;
    const localized = projectArchiveBranch(changedArchive(context.archive, replacements), options);
    return { ...data, messages: localized.data.messages };
  } catch {
    return data;
  }
}
