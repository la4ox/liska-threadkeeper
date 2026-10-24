import { getArchiveBranchCatalog } from '../../branches';
import type {
  ArchiveAsset,
  ArchiveBlock,
  ArchiveMessage,
  JsonValue,
  LiskaThreadArchive,
} from '../../types';
import { validateLiskaThreadArchive } from '../../validate';
import {
  CHATGPT_COMPARISON_HARD_LIMITS,
  CHATGPT_COMPARISON_SCHEMA,
  CHATGPT_COMPARISON_VERSION,
  ChatGptComparisonError,
  type AssetDifferenceField,
  type AssetSemanticDigest,
  type ChatGptArchiveComparison,
  type ChatGptComparisonErrorCode,
  type ChatGptComparisonFacts,
  type ChatGptComparisonLimits,
  type ChatGptComparisonScope,
  type ComparisonBucket,
  type CompareChatGptArchivesInput,
  type ConversationDifferenceField,
  type DiagnosticCountComparison,
  type MembershipDifferences,
  type MessageDifferenceField,
  type MessageSemanticDigest,
  type NodeDifferenceField,
  type SemanticDigest,
} from './contracts';
import {
  dataFields,
  jsonPrimitive,
  plainRecord,
  snapshotJson,
  type SnapshotBudget,
} from './safe-json';

export * from './contracts';

const BLOCK_FIELDS = {
  text: ['text'],
  markdown: ['markdown'],
  html: ['html'],
  code: ['code', 'language'],
  reasoning: ['text'],
  tool_call: ['toolName', 'arguments'],
  tool_result: ['toolName', 'result'],
  execution_output: ['output'],
  citation: ['label', 'url', 'content'],
  quote: ['text', 'attribution'],
  attachment: ['assetId'],
  canvas_event: ['event'],
  error: ['message', 'code'],
  unknown: ['providerType', 'raw'],
} satisfies Record<ArchiveBlock['type'], readonly string[]>;

type Projection = Record<string, JsonValue>;
interface Entity {
  projection: Projection;
  digest: SemanticDigest;
}
interface DigestTask {
  serialized: string;
  setDigest: (digest: string) => void;
}
interface Budget {
  limits: ChatGptComparisonLimits;
  digestBytes: number;
  differenceRows: number;
  tasks: DigestTask[];
  afterDigests: Array<() => void>;
}

// The exported error class is not a trust marker: caller-thrown lookalikes are sanitized too.
class InternalComparisonError extends ChatGptComparisonError {}
const INTERNAL_ERROR_CODES = new WeakMap<object, ChatGptComparisonErrorCode>();

function fail(code: ChatGptComparisonErrorCode): never {
  const error = new InternalComparisonError(code);
  INTERNAL_ERROR_CODES.set(error, code);
  throw error;
}

function requireRequest(input: CompareChatGptArchivesInput): CompareChatGptArchivesInput {
  if (!plainRecord(input)) fail('invalid-request');
  const allowed = ['left', 'right', 'sha256', 'limits'];
  const descriptors = dataFields(input, allowed.length, 'invalid-request', fail);
  if (
    Object.keys(descriptors).some(key => !allowed.includes(key)) ||
    !descriptors.left ||
    !descriptors.right ||
    typeof descriptors.sha256?.value !== 'function'
  )
    fail('invalid-request');
  return Object.fromEntries(
    Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value])
  ) as unknown as CompareChatGptArchivesInput;
}

function resolveLimits(input: unknown): ChatGptComparisonLimits {
  const limits: ChatGptComparisonLimits = { ...CHATGPT_COMPARISON_HARD_LIMITS };
  if (input === undefined) return limits;
  if (!plainRecord(input)) fail('invalid-limits');
  for (const [key, descriptor] of Object.entries(
    dataFields(input, Object.keys(limits).length, 'invalid-limits', fail)
  )) {
    if (!Object.prototype.hasOwnProperty.call(limits, key)) fail('invalid-limits');
    const value: unknown = descriptor.value;
    const limitKey = key as keyof ChatGptComparisonLimits;
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > limits[limitKey]
    )
      fail('invalid-limits');
    limits[limitKey] = value;
  }
  return limits;
}

function requireArchive(input: JsonValue): LiskaThreadArchive {
  if (!validateLiskaThreadArchive(input).valid) fail('archive-invalid');
  return input as unknown as LiskaThreadArchive;
}

function preflightBlocks(records: unknown[]): number {
  let count = 0;
  for (const node of records) {
    if (plainRecord(node) && plainRecord(node.message) && Array.isArray(node.message.blocks))
      count += node.message.blocks.length;
  }
  return count;
}

/** Cheap shape-aware caps run before the canonical validator's graph work. */
function preflight(archives: JsonValue[], limits: ChatGptComparisonLimits): void {
  let nodes = 0,
    blocks = 0,
    assets = 0,
    diagnostics = 0;
  for (const value of archives) {
    if (!plainRecord(value)) continue;
    if (plainRecord(value.graph) && plainRecord(value.graph.nodes)) {
      const records = Object.values(value.graph.nodes);
      nodes += records.length;
      blocks += preflightBlocks(records);
    }
    if (plainRecord(value.assets)) assets += Object.keys(value.assets).length;
    if (plainRecord(value.diagnostics) && Array.isArray(value.diagnostics.entries))
      diagnostics += value.diagnostics.entries.length;
  }
  if (
    nodes > limits.maxNodes ||
    blocks > limits.maxBlocks ||
    assets > limits.maxAssets ||
    diagnostics > limits.maxDiagnostics
  )
    fail('limit-exceeded');
}

function requirePair(left: LiskaThreadArchive, right: LiskaThreadArchive): void {
  if (left.inputs.length !== 1 || right.inputs.length !== 1) fail('input-count-invalid');
  if (left.conversation.provider !== 'chatgpt' || right.conversation.provider !== 'chatgpt')
    fail('provider-mismatch');
  if (left.conversation.id !== right.conversation.id) fail('conversation-mismatch');
  const normalizers = [left.inputs[0].normalizer, right.inputs[0].normalizer].sort();
  if (normalizers[0] !== 'chatgpt-official/1' || normalizers[1] !== 'chatgpt-web/1')
    fail('normalizer-pair-invalid');
}

/** Stable JSON sorts keys by code-unit, preserves arrays and never calls toJSON. */
function stableJson(value: JsonValue, maxBytes: number): string {
  const parts: string[] = [];
  const stack: Array<JsonValue | { token: string }> = [value];
  const encoder = new TextEncoder();
  const tokens = new WeakSet<object>();
  let bytes = 0;
  const append = (part: string): void => {
    bytes += encoder.encode(part).byteLength;
    if (bytes > maxBytes) fail('limit-exceeded');
    parts.push(part);
  };
  while (stack.length) {
    const next = stack.pop()!;
    if (tokens.has(next as object)) {
      append((next as { token: string }).token);
      continue;
    }
    if (jsonPrimitive(next)) {
      append(JSON.stringify(next));
      continue;
    }
    const array = Array.isArray(next);
    const keys = array ? next.map((_, index) => String(index)) : Object.keys(next).sort();
    append(array ? '[' : '{');
    const close = { token: array ? ']' : '}' };
    tokens.add(close);
    stack.push(close);
    for (let i = keys.length - 1; i >= 0; i -= 1) {
      if (i < keys.length - 1) {
        const comma = { token: ',' };
        tokens.add(comma);
        stack.push(comma);
      }
      stack.push((next as Record<string, JsonValue>)[keys[i]]);
      if (!array) {
        const key = { token: `${JSON.stringify(keys[i])}:` };
        tokens.add(key);
        stack.push(key);
      }
    }
  }
  return parts.join('');
}

function planDigest(
  budget: Budget,
  domain: string,
  projection: Projection,
  setDigest: DigestTask['setDigest']
): void {
  const serialized = stableJson(
    { domain, version: CHATGPT_COMPARISON_VERSION, value: projection },
    budget.limits.maxDigestProjectionBytes
  );
  budget.digestBytes += new TextEncoder().encode(serialized).byteLength;
  if (budget.digestBytes > budget.limits.maxAggregateDigestBytes) fail('limit-exceeded');
  budget.tasks.push({ serialized, setDigest });
}

function scope(
  archive: LiskaThreadArchive,
  side: ChatGptComparisonScope['side']
): ChatGptComparisonScope {
  const input = archive.inputs[0];
  const normalizer = input.normalizer as ChatGptComparisonScope['normalizer'];
  return {
    side,
    captureId: input.captureId,
    manifestSha256: input.manifestSha256,
    normalizer,
    sourceFormat:
      normalizer === 'chatgpt-web/1' ? 'chatgpt.web.history' : 'chatgpt.official.export',
    capturedAt: input.capturedAt,
  };
}

function facts(archive: LiskaThreadArchive): ChatGptComparisonFacts {
  const catalog = getArchiveBranchCatalog(archive);
  const nodes = Object.values(archive.graph.nodes);
  const blocksByType = Object.fromEntries(
    Object.keys(BLOCK_FIELDS)
      .sort()
      .map(type => [type, 0])
  ) as ChatGptComparisonFacts['blocksByType'];
  const assetsByAcquisitionState: ChatGptComparisonFacts['assetsByAcquisitionState'] = {
    declined: 0,
    expired: 0,
    failed: 0,
    fetched: 0,
    'not-attempted': 0,
    unavailable: 0,
  };
  let messageCount = 0,
    blockCount = 0;
  for (const node of nodes) {
    if (!node.message) continue;
    messageCount += 1;
    for (const block of node.message.blocks) {
      blockCount += 1;
      blocksByType[block.type] += 1;
    }
  }
  for (const asset of Object.values(archive.assets))
    assetsByAcquisitionState[asset.acquisition.state] += 1;
  return {
    nodeCount: nodes.length,
    structuralNodeCount: nodes.length - messageCount,
    messageCount,
    blockCount,
    blocksByType,
    assetCount: Object.keys(archive.assets).length,
    assetsByAcquisitionState,
    diagnosticCount: archive.diagnostics.entries.length,
    rootIds: [...archive.graph.rootIds],
    currentNodeId: archive.conversation.currentNodeId,
    leafIds: catalog.branches.map(branch => branch.targetNodeId).sort(),
    branchPointIds: catalog.branchPointNodeIds.sort(),
    orderEvidence: archive.diagnostics.entries.some(
      entry => entry.code === 'official-export-children-derived'
    )
      ? 'parent-derived'
      : 'explicit-or-unknown',
  };
}

function pick(value: object, keys: readonly string[]): Projection {
  return Object.fromEntries(keys.map(key => [key, (value as Projection)[key]]));
}

function blockProjection(block: ArchiveBlock): Projection {
  return { type: block.type, ...pick(block, BLOCK_FIELDS[block.type]) };
}

function messageProjection(message: ArchiveMessage, ownerNodeId: string): Projection {
  return {
    'owner-node': ownerNodeId,
    ...pick(message, [
      'author',
      'recipient',
      'channel',
      'createdAt',
      'updatedAt',
      'status',
      'model',
      'visibility',
    ]),
    blocks: message.blocks.map(blockProjection),
  };
}

function assetProjection(asset: ArchiveAsset): Projection {
  return {
    metadata: pick(asset, ['filename', 'mimeType', 'dimensions']),
    'content-claim': pick(asset, ['byteLength', 'sha256']),
    acquisition: { ...asset.acquisition, localArtifactRef: asset.localArtifactRef },
  };
}

function entity(
  projection: Projection,
  domain: string,
  budget: Budget,
  digest: SemanticDigest = { semanticSha256: '' }
): Entity {
  planDigest(budget, domain, projection, value => {
    digest.semanticSha256 = value;
  });
  return { projection, digest };
}

function entities(
  archive: LiskaThreadArchive,
  budget: Budget
): { nodes: Map<string, Entity>; messages: Map<string, Entity>; assets: Map<string, Entity> } {
  const nodes = new Map<string, Entity>(),
    messages = new Map<string, Entity>(),
    assets = new Map<string, Entity>();
  for (const id of Object.keys(archive.graph.nodes).sort()) {
    const node = archive.graph.nodes[id];
    nodes.set(
      id,
      entity(
        {
          parent: node.parentId,
          'child-membership': [...node.childIds].sort(),
          'child-order': node.childIds,
          'message-id': node.message?.id ?? null,
        },
        'node',
        budget
      )
    );
    if (node.message)
      messages.set(
        node.message.id,
        entity(messageProjection(node.message, id), 'message', budget, {
          ownerNodeId: id,
          semanticSha256: '',
        } as MessageSemanticDigest)
      );
  }
  for (const id of Object.keys(archive.assets).sort()) {
    const asset = archive.assets[id];
    assets.set(
      id,
      entity(assetProjection(asset), 'asset', budget, {
        acquisitionState: asset.acquisition.state,
        semanticSha256: '',
      } as AssetSemanticDigest)
    );
  }
  return { nodes, messages, assets };
}

function equal(left: JsonValue, right: JsonValue, budget: Budget): boolean {
  return (
    stableJson(left, budget.limits.maxDigestProjectionBytes) ===
    stableJson(right, budget.limits.maxDigestProjectionBytes)
  );
}

function addDifferenceRows(budget: Budget, count: number): void {
  budget.differenceRows += count;
  if (budget.differenceRows > budget.limits.maxDifferenceRows) fail('limit-exceeded');
}

function membership(left: string[], right: string[], budget: Budget): MembershipDifferences {
  const leftSet = new Set(left),
    rightSet = new Set(right);
  const result = {
    leftOnlyIds: left.filter(id => !rightSet.has(id)).sort(),
    rightOnlyIds: right.filter(id => !leftSet.has(id)).sort(),
  };
  addDifferenceRows(budget, result.leftOnlyIds.length + result.rightOnlyIds.length);
  return result;
}

function fieldsDifferent<Field extends string>(
  left: Projection,
  right: Projection,
  fields: readonly Field[],
  budget: Budget
): Field[] {
  return fields.filter(field => !equal(left[field], right[field], budget));
}

function bucket<Field extends string, Entry extends SemanticDigest>(
  left: Map<string, Entity>,
  right: Map<string, Entity>,
  fields: readonly Field[],
  budget: Budget
): ComparisonBucket<Field, Entry> {
  const only = membership([...left.keys()], [...right.keys()], budget);
  const conflicts: ComparisonBucket<Field, Entry>['conflicts'] = [];
  let matchedCount = 0;
  for (const id of [...left.keys()].sort()) {
    const l = left.get(id)!,
      r = right.get(id);
    if (!r) continue;
    let different = fieldsDifferent(l.projection, r.projection, fields, budget);
    if (different.includes('child-membership' as Field))
      different = different.filter(field => field !== 'child-order');
    if (!different.length) {
      matchedCount += 1;
      continue;
    }
    addDifferenceRows(budget, 1);
    const row = {
      id,
      fields: different,
      leftSemanticSha256: '',
      rightSemanticSha256: '',
      contentConflict: different.some(field => field !== 'child-order'),
    };
    conflicts.push(row);
    budget.afterDigests.push(() => {
      row.leftSemanticSha256 = l.digest.semanticSha256;
      row.rightSemanticSha256 = r.digest.semanticSha256;
    });
  }
  const records = (map: Map<string, Entity>): Record<string, Entry> =>
    Object.fromEntries([...map.keys()].sort().map(id => [id, map.get(id)!.digest as Entry]));
  return { matchedCount, ...only, left: records(left), right: records(right), conflicts };
}

/** Exact path equality uses ancestor-chain equivalence without expanding shared prefixes. */
function differingLeafPaths(
  left: LiskaThreadArchive,
  right: LiskaThreadArchive,
  leftFacts: ChatGptComparisonFacts,
  rightFacts: ChatGptComparisonFacts
): string[] {
  const samePath = new Map<string, boolean>();
  const stack = [...left.graph.rootIds];
  while (stack.length) {
    const id = stack.pop()!,
      l = left.graph.nodes[id];
    const r = Object.prototype.hasOwnProperty.call(right.graph.nodes, id)
      ? right.graph.nodes[id]
      : undefined;
    samePath.set(
      id,
      Boolean(r && l.parentId === r.parentId && (l.parentId === null || samePath.get(l.parentId)))
    );
    for (const childId of l.childIds) stack.push(childId);
  }
  const rightLeaves = new Set(rightFacts.leafIds);
  return leftFacts.leafIds.filter(id => rightLeaves.has(id) && !samePath.get(id));
}

function topology(
  left: LiskaThreadArchive,
  right: LiskaThreadArchive,
  l: ChatGptComparisonFacts,
  r: ChatGptComparisonFacts,
  budget: Budget
): ChatGptArchiveComparison['topology'] {
  const roots = membership(l.rootIds, r.rootIds, budget),
    leaves = membership(l.leafIds, r.leafIds, budget),
    branchPoints = membership(l.branchPointIds, r.branchPointIds, budget);
  const leafPathDifferenceIds = differingLeafPaths(left, right, l, r);
  const childOrderDifferenceIds = Object.keys(left.graph.nodes)
    .sort()
    .filter(id => {
      const rn = Object.prototype.hasOwnProperty.call(right.graph.nodes, id)
        ? right.graph.nodes[id]
        : undefined;
      const ln = left.graph.nodes[id];
      return (
        rn &&
        equal([...ln.childIds].sort(), [...rn.childIds].sort(), budget) &&
        !equal(ln.childIds, rn.childIds, budget)
      );
    });
  const currentNodeEqual = l.currentNodeId === r.currentNodeId,
    rootOrderEqual = equal(l.rootIds, r.rootIds, budget);
  addDifferenceRows(
    budget,
    leafPathDifferenceIds.length +
      childOrderDifferenceIds.length +
      Number(!currentNodeEqual) +
      Number(!rootOrderEqual)
  );
  const empty = (row: MembershipDifferences): boolean =>
    !row.leftOnlyIds.length && !row.rightOnlyIds.length;
  return {
    currentNodeEqual,
    rootMembershipEqual: empty(roots),
    rootOrderEqual,
    rootOrderInformational: true,
    roots,
    leafMembershipEqual: empty(leaves),
    leaves,
    branchPointMembershipEqual: empty(branchPoints),
    branchPoints,
    leafPathDifferenceIds,
    childOrderDifferenceIds,
  };
}

function diagnosticRows(
  left: LiskaThreadArchive,
  right: LiskaThreadArchive,
  budget: Budget
): DiagnosticCountComparison[] {
  const rows = new Map<string, DiagnosticCountComparison>();
  for (const [side, archive] of [
    ['leftCount', left],
    ['rightCount', right],
  ] as const) {
    for (const entry of archive.diagnostics.entries) {
      const code =
        entry.code.length <= 96 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(entry.code)
          ? entry.code
          : 'unclassified-diagnostic-code';
      const key = `${entry.severity}:${code}`;
      const row = rows.get(key) ?? { severity: entry.severity, code, leftCount: 0, rightCount: 0 };
      row[side] += 1;
      rows.set(key, row);
    }
  }
  const result = [...rows.values()].sort((a, b) =>
    a.severity < b.severity
      ? -1
      : a.severity > b.severity
        ? 1
        : a.code < b.code
          ? -1
          : a.code > b.code
            ? 1
            : 0
  );
  addDifferenceRows(budget, result.filter(row => row.leftCount !== row.rightCount).length);
  return result;
}

async function runDigests(
  budget: Budget,
  sha256: CompareChatGptArchivesInput['sha256']
): Promise<void> {
  for (const task of budget.tasks) {
    const bytes = new TextEncoder().encode(task.serialized),
      before = bytes.slice();
    let digest: unknown;
    try {
      digest = await sha256(bytes);
    } catch {
      fail('sha256-failed');
    }
    if (bytes.length !== before.length || bytes.some((value, index) => value !== before[index]))
      fail('sha256-mutated');
    if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) fail('sha256-invalid');
    task.setDigest(digest);
  }
}

function compareConversation(
  left: LiskaThreadArchive,
  right: LiskaThreadArchive,
  budget: Budget
): ChatGptArchiveComparison['conversation'] {
  const conversationFields: ConversationDifferenceField[] = [
    'title',
    'url',
    'createdAt',
    'updatedAt',
    'metadata',
  ];
  const lc = pick(left.conversation, conversationFields),
    rc = pick(right.conversation, conversationFields);
  const conversation: ChatGptArchiveComparison['conversation'] = {
    fields: fieldsDifferent(lc, rc, conversationFields, budget),
    leftSemanticSha256: '',
    rightSemanticSha256: '',
  };
  addDifferenceRows(budget, conversation.fields.length);
  planDigest(budget, 'conversation', lc, digest => {
    conversation.leftSemanticSha256 = digest;
  });
  planDigest(budget, 'conversation', rc, digest => {
    conversation.rightSemanticSha256 = digest;
  });
  return conversation;
}

function compareEntities(
  left: LiskaThreadArchive,
  right: LiskaThreadArchive,
  budget: Budget
): Pick<ChatGptArchiveComparison, 'nodes' | 'messages' | 'assets'> {
  const le = entities(left, budget),
    re = entities(right, budget);
  return {
    nodes: bucket<NodeDifferenceField, SemanticDigest>(
      le.nodes,
      re.nodes,
      ['parent', 'child-membership', 'child-order', 'message-id'],
      budget
    ),
    messages: bucket<MessageDifferenceField, MessageSemanticDigest>(
      le.messages,
      re.messages,
      [
        'owner-node',
        'author',
        'recipient',
        'channel',
        'createdAt',
        'updatedAt',
        'status',
        'model',
        'visibility',
        'blocks',
      ],
      budget
    ),
    assets: bucket<AssetDifferenceField, AssetSemanticDigest>(
      le.assets,
      re.assets,
      ['metadata', 'content-claim', 'acquisition'],
      budget
    ),
  };
}

function prepare(request: CompareChatGptArchivesInput): {
  report: ChatGptArchiveComparison;
  budget: Budget;
} {
  const limits = resolveLimits(request.limits);
  const snapshotBudget: SnapshotBudget = { limits, values: 0, stringCodeUnits: 0 };
  const detached = [
    snapshotJson(request.left, snapshotBudget, fail),
    snapshotJson(request.right, snapshotBudget, fail),
  ];
  preflight(detached, limits);
  const [left, right] = detached.map(requireArchive);
  requirePair(left, right);
  const budget: Budget = { limits, digestBytes: 0, differenceRows: 0, tasks: [], afterDigests: [] };
  const l = facts(left),
    r = facts(right);
  const conversation = compareConversation(left, right, budget);
  const entityBuckets = compareEntities(left, right, budget);
  const report: ChatGptArchiveComparison = {
    schema: CHATGPT_COMPARISON_SCHEMA,
    comparisonVersion: CHATGPT_COMPARISON_VERSION,
    identity: { provider: 'chatgpt', conversationId: left.conversation.id },
    scopes: { left: scope(left, 'left'), right: scope(right, 'right') },
    facts: { left: l, right: r },
    conversation,
    topology: topology(left, right, l, r, budget),
    ...entityBuckets,
    diagnostics: diagnosticRows(left, right, budget),
    notices: [
      'Source references remain capture-scoped; this report does not merge archives.',
      'Canonical semantic equality does not establish raw artifact equality.',
      'Exact asset ID differences do not establish asset absence; source-only identities can differ.',
    ],
  };
  if (l.orderEvidence === 'parent-derived' || r.orderEvidence === 'parent-derived')
    report.notices.push(
      'Parent-derived root or child order is informational, not a content conflict.'
    );
  return { report, budget };
}

/** Pure compare-only operation. Every source projection is detached before its first await. */
export async function compareChatGptArchives(
  input: CompareChatGptArchivesInput
): Promise<ChatGptArchiveComparison> {
  try {
    const request = requireRequest(input);
    const { report, budget } = prepare(request);
    await runDigests(budget, request.sha256);
    for (const finalize of budget.afterDigests) finalize();
    stableJson(report as unknown as JsonValue, budget.limits.maxReportBytes);
    return report;
  } catch (error) {
    const internalCode =
      typeof error === 'object' && error !== null ? INTERNAL_ERROR_CODES.get(error) : undefined;
    throw new ChatGptComparisonError(internalCode ?? 'archive-invalid');
  }
}
