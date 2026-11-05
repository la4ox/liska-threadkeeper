/** Pure detached contracts. No producer, settlement, persistence or execution capability. */
export const OPERATION_SCHEMA = 'liska-new-capture-operation/1' as const;
export const EVIDENCE_SCHEMA = 'liska-new-capture-evidence/1' as const;
export const STRICT_COMPLETENESS =
  'complete-graph-messages-branches-and-asset-inventory-all-assets-fetched-and-delivered/1' as const;
export const FILE_ASSURANCE = 'browser-download-complete-path-confirmed' as const;
export const OBSIDIAN_ASSURANCE = 'byte-readback-sha256' as const;
export const FILE_PATH_BASIS = 'download-item-complete-and-exact-relative-path-match/1' as const;

export const PURPOSE_HARD_LIMITS = Object.freeze({
  maxNodes: 50000,
  maxDepth: 16,
  maxStringCodeUnits: 1024,
  maxTotalStringCodeUnits: 2 * 1024 * 1024,
  maxArrayItems: 4096,
  maxAssetsPerDestination: 1024,
  maxIdentifierCodeUnits: 256,
  maxArtifactBytes: Number.MAX_SAFE_INTEGER,
});
export type PurposeLimits = { readonly [K in keyof typeof PURPOSE_HARD_LIMITS]: number };
export type Destination = 'file' | 'obsidian';
export type DestinationRequirement =
  | { readonly destination: 'file'; readonly assurance: typeof FILE_ASSURANCE }
  | { readonly destination: 'obsidian'; readonly assurance: typeof OBSIDIAN_ASSURANCE };

export interface CaptureBinding {
  readonly purpose: 'new-capture';
  readonly operationId: string;
  readonly attemptId: string;
  /** Reserved at operation admission, never inferred from evidence. */
  readonly captureId: string;
  readonly admission: {
    readonly provider: string;
    readonly conversationId: string;
    /** Structural validation only; no hash computation or legacy-key reinterpretation. */
    readonly conversationKey: `liska-conversation-key/1:${string}`;
  };
  readonly sourceSelection: { readonly catalogSha256: string };
}
export interface NewCaptureOperation extends CaptureBinding {
  readonly schema: typeof OPERATION_SCHEMA;
  /** All-of, canonical order: file, obsidian. */
  readonly destinations: readonly DestinationRequirement[];
  readonly completenessPolicy: typeof STRICT_COMPLETENESS;
}
export interface ArtifactCommitment {
  readonly relativePath: string;
  readonly byteLength: number;
  readonly sha256: string;
}
export type InventoryState = 'complete' | 'partial' | 'unknown';
export interface CaptureCompleteness {
  readonly policy?: typeof STRICT_COMPLETENESS;
  readonly graph?: InventoryState;
  readonly messages?: InventoryState;
  readonly branches?: InventoryState;
  readonly assetInventory?: InventoryState;
}
export interface AssetEvidence {
  readonly assetId: string;
  readonly state?: 'fetched' | 'missing' | 'unknown';
  readonly commitment?: ArtifactCommitment;
}
export interface ArtifactObservation {
  /** The expected bytes, not a claim that File has read those bytes back. */
  readonly commitment: ArtifactCommitment;
  readonly file?: {
    readonly basis?: typeof FILE_PATH_BASIS;
    readonly state?: 'complete' | 'unknown';
    readonly observedRelativePath?: string;
  };
  readonly readback?: { readonly byteLength: number; readonly sha256: string };
}
export interface DestinationAssurance {
  readonly kind?: typeof FILE_ASSURANCE | typeof OBSIDIAN_ASSURANCE;
  readonly destination?: Destination;
  /** Each destination observation is independently bound; no shared receipt. */
  readonly binding?: CaptureBinding;
  readonly manifest?: ArtifactCommitment;
  readonly artifacts?: readonly ArtifactObservation[];
}
export interface DestinationEvidence {
  readonly destination: Destination;
  readonly manifest?: ArtifactCommitment;
  readonly raw?: ArtifactCommitment;
  readonly canonical?: ArtifactCommitment;
  readonly completeness?: CaptureCompleteness;
  /** Empty is meaningful only with an explicitly complete asset inventory. */
  readonly assets?: readonly AssetEvidence[];
  readonly assurance?: DestinationAssurance;
}
/**
 * Partial envelopes and sections are representable; absence is never failure or retry authority.
 * When supplied, identity and commitment records must be structurally exact: partial or
 * malformed digests/lengths/identifiers are rejected, never filled from another record.
 */
export interface NewCaptureEvidence {
  readonly schema: typeof EVIDENCE_SCHEMA;
  readonly binding?: CaptureBinding;
  readonly destinations?: readonly DestinationEvidence[];
}

export type RejectionCode =
  | 'invalid-data'
  | 'invalid-limits'
  | 'limit-exceeded'
  | 'invalid-operation'
  | 'invalid-evidence';
export class PurposeContractError extends Error {
  constructor(readonly code: RejectionCode) {
    super(code);
    this.name = 'PurposeContractError';
  }
}
export type RelationCode =
  | 'evidence-missing'
  | 'binding-missing'
  | 'destination-missing'
  | 'artifact-missing'
  | 'assurance-missing'
  | 'completeness-missing'
  | 'completeness-incomplete'
  | 'asset-inventory-missing'
  | 'asset-not-fetched'
  | 'delivery-missing'
  | 'delivery-unconfirmed'
  | 'identity-conflict'
  | 'destination-conflict'
  | 'assurance-conflict'
  | 'commitment-conflict'
  | 'completeness-policy-conflict';
export interface EvidenceAssessment {
  readonly kind: 'consistent' | 'insufficient' | 'conflict' | 'rejected';
  readonly codes: readonly (RelationCode | RejectionCode)[];
}
