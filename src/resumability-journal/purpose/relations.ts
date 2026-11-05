import {
  FILE_ASSURANCE,
  FILE_PATH_BASIS,
  STRICT_COMPLETENESS,
  type ArtifactCommitment,
  type ArtifactObservation,
  type CaptureBinding,
  type CaptureCompleteness,
  type DestinationAssurance,
  type DestinationEvidence,
  type DestinationRequirement,
  type EvidenceAssessment,
  type NewCaptureEvidence,
  type NewCaptureOperation,
  type RelationCode,
} from './contracts';
import { freeze } from './data';

const sameCommitment = (a: ArtifactCommitment, b: ArtifactCommitment) =>
  a.relativePath === b.relativePath && a.byteLength === b.byteLength && a.sha256 === b.sha256;
const sameBinding = (a: CaptureBinding, b: CaptureBinding) =>
  a.purpose === b.purpose &&
  a.operationId === b.operationId &&
  a.attemptId === b.attemptId &&
  a.captureId === b.captureId &&
  a.admission.provider === b.admission.provider &&
  a.admission.conversationId === b.admission.conversationId &&
  a.admission.conversationKey === b.admission.conversationKey &&
  a.sourceSelection.catalogSha256 === b.sourceSelection.catalogSha256;

type AddCode = (code: RelationCode) => void;
interface RelationContext {
  readonly operation: NewCaptureOperation;
  readonly add: AddCode;
}

function binding({ operation, add }: RelationContext, value?: CaptureBinding): void {
  if (!value) add('binding-missing');
  else if (!sameBinding(operation, value)) add('identity-conflict');
}

function delivery(
  observation: ArtifactObservation,
  requirement: DestinationRequirement,
  add: AddCode
): void {
  if (requirement.assurance === FILE_ASSURANCE) {
    if (observation.readback) add('assurance-conflict');
    if (!observation.file) return add('delivery-missing');
    const file = observation.file;
    if (!file.basis) add('assurance-missing');
    else if (file.basis !== FILE_PATH_BASIS) add('assurance-conflict');
    if (file.state !== 'complete') add('delivery-unconfirmed');
    if (!file.observedRelativePath) add('delivery-missing');
    else if (file.observedRelativePath !== observation.commitment.relativePath)
      add('commitment-conflict');
  } else {
    if (observation.file) add('assurance-conflict');
    if (!observation.readback) return add('delivery-missing');
    if (
      observation.readback.sha256 !== observation.commitment.sha256 ||
      observation.readback.byteLength !== observation.commitment.byteLength
    )
      add('commitment-conflict');
  }
}

function completeness(complete: CaptureCompleteness | undefined, add: AddCode): void {
  if (!complete) return add('completeness-missing');
  if (!complete.policy) add('completeness-missing');
  else if (complete.policy !== STRICT_COMPLETENESS) add('completeness-policy-conflict');
  for (const key of ['graph', 'messages', 'branches', 'assetInventory'] as const) {
    if (!complete[key]) add('completeness-missing');
    else if (complete[key] !== 'complete') add('completeness-incomplete');
  }
}

function inventory(entry: DestinationEvidence, add: AddCode): ArtifactCommitment[] {
  const commitments: ArtifactCommitment[] = [];
  for (const key of ['manifest', 'raw', 'canonical'] as const) {
    if (entry[key]) commitments.push(entry[key]);
    else add('artifact-missing');
  }
  completeness(entry.completeness, add);
  if (!entry.assets) add('asset-inventory-missing');
  const ids = new Set<string>();
  for (const asset of entry.assets ?? []) {
    if (ids.has(asset.assetId)) add('commitment-conflict');
    ids.add(asset.assetId);
    if (asset.state !== 'fetched') add('asset-not-fetched');
    if (asset.commitment) commitments.push(asset.commitment);
    else add('artifact-missing');
  }
  const paths = new Set<string>();
  for (const commitment of commitments) {
    if (paths.has(commitment.relativePath)) add('commitment-conflict');
    paths.add(commitment.relativePath);
  }
  return commitments;
}

function assuranceBinding(
  context: RelationContext,
  assurance: DestinationAssurance,
  manifest: ArtifactCommitment | undefined,
  requirement: DestinationRequirement
): void {
  const { add } = context;
  if (!assurance.kind) add('assurance-missing');
  else if (assurance.kind !== requirement.assurance) add('assurance-conflict');
  if (!assurance.destination) add('binding-missing');
  else if (assurance.destination !== requirement.destination) add('destination-conflict');
  binding(context, assurance.binding);
  if (!assurance.manifest) add('artifact-missing');
  else if (manifest && !sameCommitment(assurance.manifest, manifest)) add('commitment-conflict');
}

// Undeclared bytes cannot contradict an inventory that is itself still missing.
function declaredInventoryPresent(entry: DestinationEvidence): boolean {
  return !!(
    entry.manifest &&
    entry.raw &&
    entry.canonical &&
    entry.assets &&
    entry.completeness?.assetInventory === 'complete' &&
    entry.assets.every(asset => asset.commitment)
  );
}

function observations(
  entry: DestinationEvidence,
  artifacts: readonly ArtifactObservation[],
  commitments: readonly ArtifactCommitment[],
  requirement: DestinationRequirement,
  add: AddCode
): void {
  const seen = new Set<string>();
  const declared = declaredInventoryPresent(entry);
  for (const observation of artifacts) {
    const path = observation.commitment.relativePath;
    if (seen.has(path)) add('commitment-conflict');
    seen.add(path);
    const expected = commitments.find(item => item.relativePath === path);
    if ((!expected && declared) || (expected && !sameCommitment(expected, observation.commitment)))
      add('commitment-conflict');
    delivery(observation, requirement, add);
  }
  for (const expected of commitments) if (!seen.has(expected.relativePath)) add('delivery-missing');
}

function destination(
  context: RelationContext,
  entry: DestinationEvidence,
  requirement: DestinationRequirement
): void {
  const commitments = inventory(entry, context.add);
  const assurance = entry.assurance;
  if (!assurance) return context.add('assurance-missing');
  assuranceBinding(context, assurance, entry.manifest, requirement);
  observations(entry, assurance.artifacts ?? [], commitments, requirement, context.add);
}

function destinations(context: RelationContext, evidence: NewCaptureEvidence): void {
  const { operation, add } = context;
  binding(context, evidence.binding);
  const entries = evidence.destinations ?? [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const required = operation.destinations.find(item => item.destination === entry.destination);
    if (seen.has(entry.destination) || !required) add('destination-conflict');
    seen.add(entry.destination);
    if (required) destination(context, entry, required);
  }
  for (const required of operation.destinations)
    if (!seen.has(required.destination)) add('destination-missing');
}

export function relate(
  operation: NewCaptureOperation,
  evidence?: NewCaptureEvidence
): EvidenceAssessment {
  const codes = new Set<RelationCode>();
  const context: RelationContext = {
    operation,
    add: code => {
      codes.add(code);
    },
  };
  if (!evidence) context.add('evidence-missing');
  else destinations(context, evidence);
  const sorted = [...codes].sort();
  const kind = sorted.some(code => code.endsWith('-conflict'))
    ? 'conflict'
    : sorted.length
      ? 'insufficient'
      : 'consistent';
  return freeze({ kind, codes: sorted });
}
