import {
  SNAPSHOT_ANALYSIS_CODES,
  SNAPSHOT_ANALYSIS_HARD_LIMITS,
  SNAPSHOT_ANALYSIS_SCHEMA,
  SNAPSHOT_ANALYSIS_VERSION,
  SNAPSHOT_PRESERVATION_REASONS,
  SNAPSHOT_RELATION_CLASSES,
  type SnapshotAnalysisEntry,
  type SnapshotAnalysisLimits,
  type SnapshotAnalysisPlan,
  type SnapshotAnalysisRelation,
  type SnapshotRelationClass,
} from './contracts';
import { inventoryEqual } from './fingerprint';
import { arrayData, compare, equalBytes, errorCode, fail, fields } from './safe-input';
import type { VerifiedSnapshot } from './verify';

type SnapshotBuckets = Map<string, VerifiedSnapshot[]>;

function addBucket(buckets: SnapshotBuckets, key: string, snapshot: VerifiedSnapshot): void {
  const bucket = buckets.get(key) ?? [];
  bucket.push(snapshot);
  buckets.set(key, bucket);
}

function sameRaw(left: VerifiedSnapshot, right: VerifiedSnapshot): boolean {
  return (
    left.identity === right.identity &&
    left.raw !== undefined &&
    right.raw !== undefined &&
    left.raw.sha256 === right.raw.sha256 &&
    equalBytes(left.raw.bytes, right.raw.bytes)
  );
}

function relationFor(
  snapshot: VerifiedSnapshot,
  inventories: SnapshotBuckets,
  raw: SnapshotBuckets,
  semantics: SnapshotBuckets
): SnapshotAnalysisRelation | null {
  const exact = inventories
    .get(snapshot.entry.inventorySha256)
    ?.find(other => inventoryEqual(other.files, snapshot.files));
  if (exact)
    return relation(
      exact,
      snapshot,
      exact.entry.verification === 'verified' && snapshot.entry.verification === 'verified'
        ? 'byte-identical'
        : 'unverifiable'
    );
  if (snapshot.entry.verification !== 'verified') return null;
  const rawKey = `${snapshot.identity}\u0000${snapshot.raw!.sha256}`;
  const same = raw.get(rawKey)?.find(other => sameRaw(other, snapshot));
  if (same) return relation(same, snapshot, 'same-raw-different-evidence');
  const semanticKey = `${snapshot.identity}\u0000${snapshot.semantic!.sha256}`;
  const candidate = semantics
    .get(semanticKey)
    ?.find(other => other.semantic!.text === snapshot.semantic!.text);
  return candidate ? relation(candidate, snapshot, 'semantic-candidate') : null;
}

function relation(
  left: VerifiedSnapshot,
  right: VerifiedSnapshot,
  classification: SnapshotRelationClass
): SnapshotAnalysisRelation {
  return {
    left: left.entry.ordinal,
    right: right.entry.ordinal,
    classification,
    preserveBoth: true,
  };
}

/** One predecessor per candidate avoids quadratic all-pairs report growth. */
function candidateRelations(
  snapshots: VerifiedSnapshot[],
  limits: SnapshotAnalysisLimits
): SnapshotAnalysisRelation[] {
  const inventories: SnapshotBuckets = new Map();
  const raw: SnapshotBuckets = new Map();
  const semantics: SnapshotBuckets = new Map();
  const relations: SnapshotAnalysisRelation[] = [];
  for (const snapshot of snapshots) {
    const candidate = relationFor(snapshot, inventories, raw, semantics);
    if (candidate) {
      if (relations.length >= limits.maxRelations) fail('limit-exceeded');
      relations.push(candidate);
    }
    addBucket(inventories, snapshot.entry.inventorySha256, snapshot);
    if (snapshot.entry.verification === 'verified') {
      addBucket(raw, `${snapshot.identity}\u0000${snapshot.raw!.sha256}`, snapshot);
      addBucket(semantics, `${snapshot.identity}\u0000${snapshot.semantic!.sha256}`, snapshot);
    }
  }
  for (const bucket of inventories.values()) {
    for (const snapshot of bucket) {
      if (!bucket.some(other => other !== snapshot && inventoryEqual(other.files, snapshot.files)))
        snapshot.reasons.add('unique-evidence');
    }
  }
  return relations.sort((left, right) => left.left - right.left || left.right - right.right);
}

function chronologicalGroups(snapshots: VerifiedSnapshot[]): SnapshotBuckets {
  const identities: SnapshotBuckets = new Map();
  for (const snapshot of snapshots) {
    if (snapshot.identity && snapshot.observedAt && snapshot.raw)
      addBucket(identities, snapshot.identity, snapshot);
  }
  return identities;
}

function graphSet(group: readonly VerifiedSnapshot[]): Set<string> {
  return new Set(group.flatMap(snapshot => (snapshot.graph ? [snapshot.graph.text] : [])));
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every(value => right.has(value));
}

function markGraphChange(group: readonly VerifiedSnapshot[]): void {
  for (const snapshot of group) if (snapshot.graph) snapshot.reasons.add('graph-change');
}

function graphChanges(groups: readonly (readonly VerifiedSnapshot[])[]): void {
  for (const group of groups) {
    if (graphSet(group).size > 1) markGraphChange(group);
  }
  const comparable = groups
    .map(group => ({ group, graphs: graphSet(group) }))
    .filter(candidate => candidate.graphs.size > 0);
  for (let index = 1; index < comparable.length; index += 1) {
    const left = comparable[index - 1];
    const right = comparable[index];
    if (!sameSet(left.graphs, right.graphs)) {
      markGraphChange(left.group);
      markGraphChange(right.group);
    }
  }
}

function preserveChronology(snapshots: VerifiedSnapshot[]): void {
  for (const group of chronologicalGroups(snapshots).values()) {
    const byTime = new Map<string, VerifiedSnapshot[]>();
    for (const snapshot of group) addBucket(byTime, snapshot.observedAt!, snapshot);
    const ordered = [...byTime.entries()]
      .sort(([left], [right]) => compare(left, right))
      .map(([, tied]) => tied);
    for (const snapshot of ordered[0]) snapshot.reasons.add('first-observed');
    for (const snapshot of ordered[ordered.length - 1]) snapshot.reasons.add('latest-observed');
    for (const tied of ordered) {
      if (tied.length > 1) {
        for (const snapshot of tied) snapshot.reasons.add('chronology-ambiguous');
      }
    }
    graphChanges(ordered);
  }
}

export function buildSnapshotPlan(
  snapshots: VerifiedSnapshot[],
  limits: SnapshotAnalysisLimits
): SnapshotAnalysisPlan {
  const relations = candidateRelations(snapshots, limits);
  preserveChronology(snapshots);
  return {
    schema: SNAPSHOT_ANALYSIS_SCHEMA,
    algorithmVersion: SNAPSHOT_ANALYSIS_VERSION,
    analysisOnly: true,
    mutationAuthorized: false,
    referenceCoverage: 'selected-inputs-only',
    snapshots: snapshots.map(snapshot => ({
      ...snapshot.entry,
      preserveReasons: SNAPSHOT_PRESERVATION_REASONS.filter(reason => snapshot.reasons.has(reason)),
    })),
    relations,
  };
}

function number(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max)
    fail('invalid-plan');
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) fail('invalid-plan');
  return value;
}

function planEntry(value: unknown, ordinal: number): SnapshotAnalysisEntry {
  const entry = fields(
    value,
    [
      'ordinal',
      'verification',
      'code',
      'measuredByteLength',
      'fileCount',
      'inventorySha256',
      'preserveReasons',
    ],
    [],
    'invalid-plan'
  );
  if (
    entry.ordinal !== ordinal ||
    !['verified', 'partial', 'unverifiable'].includes(entry.verification as string) ||
    (entry.code !== null && !SNAPSHOT_ANALYSIS_CODES.includes(entry.code as never))
  )
    fail('invalid-plan');
  if ((entry.verification === 'unverifiable') !== (entry.code !== null)) fail('invalid-plan');
  const reasons = arrayData(
    entry.preserveReasons,
    SNAPSHOT_PRESERVATION_REASONS.length,
    'invalid-plan'
  );
  if (
    new Set(reasons).size !== reasons.length ||
    reasons.some(reason => !SNAPSHOT_PRESERVATION_REASONS.includes(reason as never))
  )
    fail('invalid-plan');
  const preserveReasons = SNAPSHOT_PRESERVATION_REASONS.filter(reason => reasons.includes(reason));
  if (!preserveReasons.includes('external-references-unassessed')) fail('invalid-plan');
  return {
    ordinal,
    verification: entry.verification as SnapshotAnalysisEntry['verification'],
    code: entry.code as SnapshotAnalysisEntry['code'],
    measuredByteLength: number(
      entry.measuredByteLength,
      SNAPSHOT_ANALYSIS_HARD_LIMITS.maxTotalBytes
    ),
    fileCount: number(entry.fileCount, SNAPSHOT_ANALYSIS_HARD_LIMITS.maxFilesPerSnapshot),
    inventorySha256: digest(entry.inventorySha256),
    preserveReasons,
  };
}

function planRelations(
  value: unknown,
  entries: readonly SnapshotAnalysisEntry[]
): SnapshotAnalysisRelation[] {
  const relations = arrayData(
    value,
    SNAPSHOT_ANALYSIS_HARD_LIMITS.maxRelations,
    'invalid-plan'
  ).map(candidate => {
    const row = fields(
      candidate,
      ['left', 'right', 'classification', 'preserveBoth'],
      [],
      'invalid-plan'
    );
    const left = number(row.left, entries.length - 1),
      right = number(row.right, entries.length - 1);
    if (
      left >= right ||
      row.preserveBoth !== true ||
      !SNAPSHOT_RELATION_CLASSES.includes(row.classification as never)
    )
      fail('invalid-plan');
    if (
      row.classification !== 'unverifiable' &&
      (entries[left].verification !== 'verified' || entries[right].verification !== 'verified')
    )
      fail('invalid-plan');
    return {
      left,
      right,
      classification: row.classification as SnapshotRelationClass,
      preserveBoth: true as const,
    };
  });
  if (new Set(relations.map(row => `${row.left}:${row.right}`)).size !== relations.length)
    fail('invalid-plan');
  return relations.sort((a, b) => a.left - b.left || a.right - b.right);
}

/** Shape-checks and serializes safe fixed fields, not proof of analyzer provenance. */
export function encodeSnapshotAnalysisPlan(
  plan: SnapshotAnalysisPlan,
  maxBytes = SNAPSHOT_ANALYSIS_HARD_LIMITS.maxReportBytes
): Uint8Array {
  try {
    number(maxBytes, SNAPSHOT_ANALYSIS_HARD_LIMITS.maxReportBytes);
    const root = fields(
      plan,
      [
        'schema',
        'algorithmVersion',
        'analysisOnly',
        'mutationAuthorized',
        'referenceCoverage',
        'snapshots',
        'relations',
      ],
      [],
      'invalid-plan'
    );
    if (
      root.schema !== SNAPSHOT_ANALYSIS_SCHEMA ||
      root.algorithmVersion !== SNAPSHOT_ANALYSIS_VERSION ||
      root.analysisOnly !== true ||
      root.mutationAuthorized !== false ||
      root.referenceCoverage !== 'selected-inputs-only'
    )
      fail('invalid-plan');
    const snapshots = arrayData(
      root.snapshots,
      SNAPSHOT_ANALYSIS_HARD_LIMITS.maxSnapshots,
      'invalid-plan'
    ).map(planEntry);
    if (snapshots.length < 2) fail('invalid-plan');
    const safe: SnapshotAnalysisPlan = {
      schema: SNAPSHOT_ANALYSIS_SCHEMA,
      algorithmVersion: SNAPSHOT_ANALYSIS_VERSION,
      analysisOnly: true,
      mutationAuthorized: false,
      referenceCoverage: 'selected-inputs-only',
      snapshots,
      relations: planRelations(root.relations, snapshots),
    };
    const bytes = new TextEncoder().encode(JSON.stringify(safe, null, 2) + '\n');
    if (bytes.byteLength > maxBytes) fail('limit-exceeded');
    return bytes;
  } catch (error) {
    fail(errorCode(error, 'invalid-plan'));
  }
}
