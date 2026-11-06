/** Factual producer receipt, separate from the legacy link receipt and journal v1. */
import {
  detachProducerData,
  freezeProducerData,
  invalidProducerEvidence,
  producerBytes,
  producerHash,
  producerId,
  producerList,
  producerPath,
  producerRecord,
  type ProducerData,
} from './producer-evidence-data';

export const CHATGPT_PRODUCER_SCHEMA = 'liska-chatgpt-producer-evidence/1' as const;
export type ProducerDestination = 'file' | 'obsidian';
export interface ProducerCommitment {
  readonly relativePath: string;
  readonly byteLength: number;
  readonly sha256: string;
}
export type SinkObservation =
  | {
      readonly kind: 'browser-download-complete-path-confirmed';
      readonly observedRelativePath: string;
    }
  | { readonly kind: 'byte-readback-sha256'; readonly byteLength: number; readonly sha256: string };
export interface ProducerArtifactObservation {
  readonly destination: ProducerDestination;
  readonly commitment: ProducerCommitment;
  /** Absence means no exact sink assurance was retained, even if legacy success is true. */
  readonly observation?: SinkObservation;
}
/** Supplied before any write; never manufactured from a completed capture. */
export interface ChatGptProducerIntent {
  readonly operationId: string;
  readonly attemptId: string;
  readonly captureId: string;
  readonly provider: 'chatgpt';
  readonly conversationId: string;
  readonly conversationKey: `liska-conversation-key/1:${string}`;
  readonly catalogSha256: string;
  readonly requiredDestinations: readonly ProducerDestination[];
}
export type ProducerCompletenessState = 'complete' | 'partial' | 'unknown' | 'not-attempted';
export interface ChatGptProducerReceipt {
  readonly schema: typeof CHATGPT_PRODUCER_SCHEMA;
  readonly provider: 'chatgpt';
  readonly conversationId: string;
  readonly captureId: string;
  /** Routing only: SHA256(conversationId), NEVER a provider-aware identity key. */
  readonly legacyRoutingDigest: string;
  readonly requestedDestinations: readonly ProducerDestination[];
  readonly intent?: ChatGptProducerIntent;
  readonly destination: ProducerDestination;
  readonly raw: ProducerCommitment;
  readonly manifest: ProducerCommitment;
  readonly canonical: ProducerCommitment;
  readonly completeness: Readonly<
    Record<'graph' | 'messages' | 'branches' | 'assets', ProducerCompletenessState>
  >;
  readonly assets: readonly {
    readonly assetId: string;
    readonly state: 'not-attempted' | 'fetched' | 'unavailable' | 'declined' | 'expired' | 'failed';
    readonly commitment?: ProducerCommitment;
  }[];
  readonly observations: readonly ProducerArtifactObservation[];
}
function check(condition: unknown): void {
  if (!condition) invalidProducerEvidence();
}
function destination(value: ProducerData | undefined): void {
  check(value === 'file' || value === 'obsidian');
}
function destinations(value: ProducerData | undefined): void {
  const values = producerList(value, 2);
  check(values.length > 0 && new Set(values).size === values.length);
  values.forEach(destination);
  values.sort();
}
function commitment(value: ProducerData | undefined): void {
  const data = producerRecord(value, ['relativePath', 'byteLength', 'sha256']);
  producerPath(data.relativePath);
  producerBytes(data.byteLength);
  producerHash(data.sha256);
}
function observation(value: ProducerData | undefined): void {
  const data = producerRecord(value, ['kind'], ['observedRelativePath', 'byteLength', 'sha256']);
  if (data.kind === 'browser-download-complete-path-confirmed') {
    producerRecord(data, ['kind', 'observedRelativePath']);
    producerPath(data.observedRelativePath);
  } else {
    check(data.kind === 'byte-readback-sha256');
    producerRecord(data, ['kind', 'byteLength', 'sha256']);
    producerBytes(data.byteLength);
    producerHash(data.sha256);
  }
}
function intent(value: ProducerData | undefined): void {
  const data = producerRecord(value, [
    'operationId',
    'attemptId',
    'captureId',
    'provider',
    'conversationId',
    'conversationKey',
    'catalogSha256',
    'requiredDestinations',
  ]);
  for (const key of ['operationId', 'attemptId', 'captureId', 'conversationId'])
    producerId(data[key]);
  check(data.provider === 'chatgpt');
  check(
    typeof data.conversationKey === 'string' &&
      /^liska-conversation-key\/1:[a-f0-9]{64}$/u.test(data.conversationKey)
  );
  producerHash(data.catalogSha256);
  destinations(data.requiredDestinations);
}
export function snapshotChatGptProducerIntent(input: unknown): ChatGptProducerIntent {
  const data = detachProducerData(input);
  intent(data);
  return freezeProducerData(data) as unknown as ChatGptProducerIntent;
}
export function snapshotSinkObservation(input: unknown): SinkObservation | undefined {
  try {
    const data = detachProducerData(input);
    observation(data);
    return freezeProducerData(data) as unknown as SinkObservation;
  } catch {
    return undefined;
  }
}
export function producerCommitment(value: ProducerCommitment): ProducerCommitment {
  return { relativePath: value.relativePath, byteLength: value.byteLength, sha256: value.sha256 };
}
/** Only a success plus an exact typed sink observation survives; accounting is never consulted. */
export function observeProducerArtifact(
  destination: ProducerDestination,
  artifact: ProducerCommitment,
  result: unknown
): ProducerArtifactObservation {
  let fact: SinkObservation | undefined;
  try {
    const data = Object.getOwnPropertyDescriptors(result as object);
    if (data.success?.value === true && data.destination?.value === destination)
      fact = snapshotSinkObservation(data.sinkObservation?.value);
  } catch {
    /* Unknown issued write: retain commitment without assurance. */
  }
  return freezeProducerData({
    destination,
    commitment: producerCommitment(artifact),
    ...(fact && { observation: fact }),
  });
}
// eslint-disable-next-line max-lines-per-function -- One exact versioned envelope parser, with no inferred fields.
export function snapshotChatGptProducerReceipt(input: unknown): ChatGptProducerReceipt {
  const data = producerRecord(
    detachProducerData(input),
    [
      'schema',
      'provider',
      'conversationId',
      'captureId',
      'legacyRoutingDigest',
      'requestedDestinations',
      'destination',
      'raw',
      'manifest',
      'canonical',
      'completeness',
      'assets',
      'observations',
    ],
    ['intent']
  );
  check(data.schema === CHATGPT_PRODUCER_SCHEMA && data.provider === 'chatgpt');
  producerId(data.conversationId);
  producerId(data.captureId);
  producerHash(data.legacyRoutingDigest);
  destinations(data.requestedDestinations);
  destination(data.destination);
  if ('intent' in data) intent(data.intent);
  for (const key of ['raw', 'manifest', 'canonical']) commitment(data[key]);
  const complete = producerRecord(data.completeness, ['graph', 'messages', 'branches', 'assets']);
  Object.values(complete).forEach(value =>
    check(['complete', 'partial', 'unknown', 'not-attempted'].includes(value as string))
  );
  const ids = new Set<string>();
  for (const value of producerList(data.assets)) {
    const asset = producerRecord(value, ['assetId', 'state'], ['commitment']);
    const id = producerId(asset.assetId);
    check(!ids.has(id));
    ids.add(id);
    check(
      ['not-attempted', 'fetched', 'unavailable', 'declined', 'expired', 'failed'].includes(
        asset.state as string
      )
    );
    if ('commitment' in asset) commitment(asset.commitment);
  }
  for (const value of producerList(data.observations, 1027)) {
    const item = producerRecord(value, ['destination', 'commitment'], ['observation']);
    destination(item.destination);
    commitment(item.commitment);
    if ('observation' in item) observation(item.observation);
  }
  return freezeProducerData(data) as unknown as ChatGptProducerReceipt;
}

export function snapshotProducerObservations(
  input: unknown
): readonly ProducerArtifactObservation[] {
  const values = producerList(detachProducerData(input), 2054);
  for (const value of values) {
    const item = producerRecord(value, ['destination', 'commitment'], ['observation']);
    destination(item.destination);
    commitment(item.commitment);
    if ('observation' in item) observation(item.observation);
  }
  return freezeProducerData(values) as unknown as readonly ProducerArtifactObservation[];
}
