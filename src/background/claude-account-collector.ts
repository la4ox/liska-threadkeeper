import { admitClaudeAccountCatalog } from '../claude-baseline/account-admission';
import {
  CLAUDE_MANUAL_VISIBLE_PERSONAL_CONTEXT,
  type ClaudeAccountScopeSha256,
} from '../claude-baseline/account-admission-contracts';
import {
  openAccountCatalog,
  AccountCatalogError,
  type AccountCatalog,
} from '../account-catalog-owner';
import { snapshotSlotTarget, type SlotTarget } from '../lib/account-slot-contract';
import {
  collectorSummary,
  type CollectorCode,
  type CollectorSummary,
  type CollectorSource,
  snapshotCollectorSource,
} from '../lib/claude-account-collector-contract';
import {
  CollectorSession,
  CollectorStop,
  type CollectorBrowser,
} from './claude-account-collector-lifecycle';
import { collectClaudeAccountPages } from './claude-account-collector-page';
import { snapshotCollectorProjection } from './claude-account-collector-projection';

interface Dependencies {
  source: CollectorSource;
  slot: SlotTarget;
  operations: Set<number>;
  permitted: () => Promise<boolean>;
  browser?: CollectorBrowser;
  now?: () => number;
  timeoutMs?: number;
  openCatalog?: typeof openAccountCatalog;
  sha256?: ClaudeAccountScopeSha256;
}
function nativeHash(): ClaudeAccountScopeSha256 {
  const encoder = new TextEncoder(),
    encode = encoder.encode.bind(encoder);
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  return async input => new Uint8Array(await digest('SHA-256', encode(input)));
}
function newCollectionId() {
  return (
    'claude-account-collection/1:' +
    Array.from(crypto.getRandomValues(new Uint8Array(16)), byte =>
      byte.toString(16).padStart(2, '0')
    ).join('')
  );
}
function errorCode(error: unknown, fallback: CollectorCode): CollectorCode {
  if (error instanceof CollectorStop) return error.code;
  if (!(error instanceof AccountCatalogError)) return fallback;
  switch (error.code) {
    case 'conflict':
      return 'owner-conflict';
    case 'capacity':
      return 'scoped-capacity';
    case 'quota-exceeded':
      return 'scoped-quota';
    case 'unsupported':
      return 'scoped-store-unsupported';
    case 'corrupt':
      return 'scoped-store-corrupt';
    case 'transaction-outcome-unknown':
      return fallback === 'owner-outcome-unknown' ? fallback : 'scoped-read-unknown';
    case 'transaction-aborted':
      return fallback === 'owner-outcome-unknown' ? 'owner-aborted' : 'scoped-read-unknown';
    default:
      return fallback === 'owner-outcome-unknown'
        ? 'owner-create-refused'
        : 'scoped-store-unavailable';
  }
}

/** The sole production bridge from a trusted gesture and two private list replies to a paused seed. */
// eslint-disable-next-line complexity, max-lines-per-function -- Source verification, admission and native terminal truth share one deadline and one cleanup owner.
export async function collectClaudeAccountCatalog(deps: Dependencies): Promise<CollectorSummary> {
  const now = deps.now ?? Date.now;
  const deadline = now() + Math.min(20000, Math.max(1, deps.timeoutMs ?? 20000));
  let session: CollectorSession | undefined, owner: AccountCatalog | undefined;
  let progress = { dispatch: 0, page: 0, target: 0, marker: 0 };
  let fallback: CollectorCode = 'document-unavailable';
  let retention: 'none' | 'existing' | 'committed' = 'none';
  const closeOwner = async () => {
    const handle = owner;
    owner = undefined;
    await handle?.close();
  };
  try {
    const source = snapshotCollectorSource(deps.source);
    const slot = snapshotSlotTarget(deps.slot);
    if (!source || !slot) return collectorSummary('invalid-message');
    const token = crypto.randomUUID();
    session = new CollectorSession(
      deps.browser ?? chrome,
      deps.operations,
      deadline,
      now,
      token,
      source
    );
    await session.select();
    if (!(await session.wait(deps.permitted))) throw new CollectorStop('permission-unavailable');
    await session.verify();
    fallback = 'source-verification-unavailable';
    await session.arm();
    await session.verify();
    const projection = snapshotCollectorProjection(
      await session.pinned(collectClaudeAccountPages, [source.url, deadline, token]),
      source.url.slice(-36)
    );
    if (!projection) throw new CollectorStop('result-invalid');
    progress = projection.progress;
    await session.disarm();
    await session.verify();
    if (projection.kind === 'stopped') return collectorSummary(projection.code, progress);
    fallback = 'hash-failed';
    const hash = deps.sha256 ?? nativeHash();
    const admitted = await session.wait(() =>
      admitClaudeAccountCatalog(
        { ...projection.input, manualAttestation: CLAUDE_MANUAL_VISIBLE_PERSONAL_CONTEXT },
        hash
      )
    );
    await session.verify();
    if (admitted.kind !== 'admitted')
      throw new CollectorStop(
        admitted.reason === 'hash-failed' ? 'hash-failed' : 'admission-rejected'
      );
    fallback = 'scoped-store-unavailable';
    await session.wait(async () => {
      owner = await (deps.openCatalog ?? openAccountCatalog)({
        timeoutMs: Math.min(5000, Math.max(1, deadline - now())),
      });
    });
    await session.verify();
    const current = await session.wait(() => owner!.readSlot(slot.slotId));
    await session.verify();
    const scopeKey = admitted.catalog.scopeKey;
    if (slot.kind === 'existing') {
      if (!current || current.slotId !== slot.slotId || current.provider !== 'claude')
        throw new CollectorStop('slot-missing');
      const owners = await session.wait(() => owner!.listOwners(slot.slotId));
      if (
        !owners.some(
          item =>
            item.provider === 'claude' && item.slotId === slot.slotId && item.scopeKey === scopeKey
        )
      )
        throw new CollectorStop(owners.length ? 'slot-scope-mismatch' : 'scoped-store-corrupt');
      retention = 'existing';
    } else {
      if (current !== null) throw new CollectorStop('owner-conflict');
      const collectionId = newCollectionId();
      session.check();
      fallback = 'owner-outcome-unknown';
      // Deadline requests abort; await the native terminal outcome rather than racing it.
      const result = await owner!.createPausedClaudeSingleScope(
        { slotId: slot.slotId, label: slot.label, collectionId, admission: admitted },
        session.controller.signal
      );
      if (
        (result.kind !== 'created' && result.kind !== 'already-created') ||
        result.slot?.slotId !== slot.slotId ||
        result.slot.provider !== 'claude' ||
        result.slot.label !== slot.label ||
        result.owner?.provider !== 'claude' ||
        result.owner.slotId !== slot.slotId ||
        result.owner.collectionId !== collectionId ||
        result.owner.scopeKey !== scopeKey
      )
        throw new CollectorStop('owner-outcome-unknown');
      retention = 'committed';
    }
    // Close starts synchronously; a slow/rejecting close must not erase commit truth.
    await session.wait(closeOwner);
    await session.verify();
    return collectorSummary(
      retention === 'existing' ? 'scoped-owner-already-present' : 'saved',
      progress
    );
  } catch (error) {
    const code = errorCode(error, fallback);
    if (retention !== 'none') {
      const reason =
        code === 'deadline-exceeded'
          ? 'verification-deadline'
          : code === 'navigation-changed'
            ? 'context-changed'
            : 'verification-unavailable';
      return collectorSummary(`${retention}-${reason}`, progress);
    }
    // Without a verified source, counts from an unverified scripting reply are not evidence.
    return code === 'document-unavailable'
      ? collectorSummary(code)
      : collectorSummary(code, progress);
  } finally {
    const closing = closeOwner().catch(() => undefined);
    await session?.close(async () => {
      await closing;
      await closeOwner();
    }); // also closes a late open
  }
}
