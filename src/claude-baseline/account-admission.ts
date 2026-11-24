import {
  CLAUDE_ACCOUNT_CATALOG_ADMISSION_SCHEMA,
  CLAUDE_MANUAL_VISIBLE_PERSONAL_CONTEXT,
  type ClaudeAccountCatalogAdmissionFailure,
  type ClaudeAccountCatalogAdmissionResult,
  type ClaudeAccountScopeSha256,
} from './account-admission-contracts';
import {
  CLAUDE_PERSONAL_SCOPE_ATTESTATION_SCHEMA,
  type ClaudeBaselineLimits,
  type ClaudeBaselineTarget,
} from './contracts';
import { arrayData, fail, fields, nonemptyString, rejectionReason, resolveLimits } from './data';
import { enumerateClaudeBaselineCatalog } from './enumeration';

const domain = 'liska-claude-account-catalog-scope/1';
const origin = 'https://claude.ai';
const organizationHeader = 'anthropic-organization-id';
const workspaceHeader = 'anthropic-workspace-id';
const scopePrefix = 'claude-list-scope/1:';
const digestSize = 32;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;

function rejected(
  reason: ClaudeAccountCatalogAdmissionFailure
): ClaudeAccountCatalogAdmissionResult {
  return Object.freeze({
    kind: 'rejected',
    schema: CLAUDE_ACCOUNT_CATALOG_ADMISSION_SCHEMA,
    reason,
  });
}

function uuid(value: unknown, limits: ClaudeBaselineLimits): string {
  const id = nonemptyString(value, limits.maxIdentityCodeUnits);
  if (id.length !== 36 || !uuidPattern.test(id)) fail();
  return id;
}

function headerPair(value: unknown, limits: ClaudeBaselineLimits) {
  const headers = fields(value, [organizationHeader, workspaceHeader], [], limits);
  const organization = uuid(headers[organizationHeader], limits);
  const workspace = nonemptyString(headers[workspaceHeader], limits.maxIdentityCodeUnits);
  if (/[^A-Za-z0-9._~-]/u.test(workspace)) fail();
  return { organization, workspace };
}

function terminalRecords(value: unknown, limits: ClaudeBaselineLimits): unknown[] | null {
  const page = fields(value, ['offset', 'body'], [], limits);
  const body = fields(page.body, ['data', 'has_more'], [], limits);
  if (!Number.isSafeInteger(page.offset) || typeof body.has_more !== 'boolean') fail();
  if (!Object.is(page.offset, 0) || body.has_more) return null;
  return arrayData(body.data, limits);
}

function activeTargets(records: unknown[], limits: ClaudeBaselineLimits): ClaudeBaselineTarget[] {
  const ids = new Set<string>();
  return records.map(value => {
    const record = fields(value, ['uuid', 'is_archived'], ['updated_at'], limits);
    const conversationId = uuid(record.uuid, limits);
    if (record.is_archived !== false) fail();
    if (ids.has(conversationId)) fail('duplicate-conversation-id');
    ids.add(conversationId);
    if (!('updated_at' in record)) return { conversationId };
    return {
      conversationId,
      marker: {
        source: 'claude-chat-conversations-v2.updated_at/1',
        token: nonemptyString(record.updated_at, limits.maxTokenCodeUnits),
      },
    };
  });
}

function digestHex(value: unknown): string | null {
  if (
    !(value instanceof Uint8Array) ||
    !ArrayBuffer.isView(value) ||
    Object.getPrototypeOf(value) !== Uint8Array.prototype ||
    Object.getOwnPropertyDescriptor(value, 'length') ||
    Object.getOwnPropertyDescriptor(value, Symbol.toStringTag) ||
    Object.prototype.toString.call(value) !== '[object Uint8Array]' ||
    value.length !== digestSize ||
    Reflect.ownKeys(value).length !== digestSize
  )
    return null;
  let hex = '';
  for (let index = 0; index < digestSize; index += 1)
    hex += value[index].toString(16).padStart(2, '0');
  return hex;
}

async function deriveKey(
  { organization, workspace }: ReturnType<typeof headerPair>,
  sha256: ClaudeAccountScopeSha256
): Promise<string | null> {
  try {
    if (typeof sha256 !== 'function') return null;
    const pending = sha256(
      JSON.stringify([domain, origin, organizationHeader, organization, workspaceHeader, workspace])
    );
    // Accept direct bytes or a native promise, never read a getter from an ad-hoc thenable.
    let bytes: unknown = pending;
    if (pending instanceof Promise) bytes = await pending;
    const hex = digestHex(bytes);
    return hex === null ? null : `${scopePrefix}${hex}`;
  } catch {
    return null;
  }
}

/**
 * Snapshot all output-bearing data before awaiting the injected hash. The returned
 * pair is only a temporary input to that dependency, never an output field.
 */
function admissionData(input: unknown, limits: ClaudeBaselineLimits) {
  const data = fields(
    input,
    ['routeOrganization', 'scopeHeaders', 'manualAttestation', 'activePage', 'archivedPage'],
    [],
    limits
  );
  if (data.manualAttestation !== CLAUDE_MANUAL_VISIBLE_PERSONAL_CONTEXT)
    return 'manual-attestation-required';
  const pair = headerPair(data.scopeHeaders, limits);
  if (pair.organization !== uuid(data.routeOrganization, limits)) return 'scope-mismatch';
  const active = terminalRecords(data.activePage, limits);
  if (active === null) return 'active-pagination-unsupported';
  const archived = terminalRecords(data.archivedPage, limits);
  if (archived === null) return 'archived-pagination-unsupported';
  if (archived.length !== 0) return 'nonempty-archived-unsupported';
  const records = activeTargets(active, limits);
  const repeatsScopeValue = (value: string | undefined) =>
    value === pair.organization || value === pair.workspace;
  if (
    records.some(
      record => repeatsScopeValue(record.conversationId) || repeatsScopeValue(record.marker?.token)
    )
  )
    return 'scope-value-in-target';
  if (limits.maxScopeKeyCodeUnits < scopePrefix.length + 2 * digestSize) fail('limit-exceeded');
  return { pair, records };
}

/**
 * Structural admission only. Its future caller must own the active/archived reads,
 * verify the exact raw pair on both, and bind the manual gesture to that same document.
 */
export async function admitClaudeAccountCatalog(
  input: unknown,
  sha256: ClaudeAccountScopeSha256,
  limitOverrides?: unknown
): Promise<ClaudeAccountCatalogAdmissionResult> {
  try {
    const limits = resolveLimits(limitOverrides);
    const data = admissionData(input, limits);
    if (typeof data === 'string') return rejected(data);
    const scopeKey = await deriveKey(data.pair, sha256);
    if (scopeKey === null) return rejected('hash-failed');
    const catalog = enumerateClaudeBaselineCatalog(
      {
        kind: 'observed_page',
        schema: 'claude-list-page-observation/1',
        scopeKey,
        records: data.records,
      },
      {
        schema: CLAUDE_PERSONAL_SCOPE_ATTESTATION_SCHEMA,
        evidence: 'manual-personal-scope',
        scopeKey,
        organizationBinding: 'resolved',
        workspaceBinding: 'resolved',
      },
      limits
    );
    if (catalog.kind !== 'catalog')
      return rejected(catalog.kind === 'rejected' ? catalog.reason : 'invalid-input');
    return Object.freeze({
      kind: 'admitted',
      schema: CLAUDE_ACCOUNT_CATALOG_ADMISSION_SCHEMA,
      catalog,
      evidence: Object.freeze({
        provenance: 'caller-projected',
        scopeDerivation: 'provided-header-pair-sha256',
        personalContextAssertion: CLAUDE_MANUAL_VISIBLE_PERSONAL_CONTEXT,
        active: 'offset-0-terminal-projected',
        archived: 'offset-0-terminal-empty-projected',
        accountComplete: false,
        executionAuthorized: false,
      }),
    });
  } catch (error) {
    return rejected(rejectionReason(error));
  }
}
