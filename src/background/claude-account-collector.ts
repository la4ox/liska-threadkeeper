import { admitClaudeAccountCatalog } from '../claude-baseline/account-admission';
import {
  CLAUDE_MANUAL_VISIBLE_PERSONAL_CONTEXT,
  type ClaudeAccountScopeSha256,
} from '../claude-baseline/account-admission-contracts';
import {
  openClaudeAccountBaselineOwner,
  ClaudeAccountBaselineOwnerError,
  type ClaudeAccountBaselineOwner,
} from '../claude-account-baseline-owner';
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
  operations: Set<number>;
  permitted: () => Promise<boolean>;
  browser?: CollectorBrowser;
  now?: () => number;
  timeoutMs?: number;
  openOwner?: typeof openClaudeAccountBaselineOwner;
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
  if (error instanceof ClaudeAccountBaselineOwnerError) {
    if (fallback === 'owner-outcome-unknown') {
      if (error.code === 'conflict') return 'owner-conflict';
      if (error.code === 'transaction-aborted') return 'owner-aborted';
      if (error.code === 'transaction-outcome-unknown') return 'owner-outcome-unknown';
      return 'owner-create-refused';
    }
    if (error.code === 'transaction-outcome-unknown') return 'owner-preflight-unknown';
    if (error.code === 'unsupported') return 'owner-unsupported';
    if (error.code === 'corrupt') return 'owner-corrupt';
    return 'owner-unavailable';
  }
  return fallback;
}

/** The sole production bridge from a trusted gesture and two private list replies to a paused seed. */
// eslint-disable-next-line complexity, max-lines-per-function -- Preflight, admission and native terminal truth share one deadline and one cleanup owner.
export async function collectClaudeAccountCatalog(deps: Dependencies): Promise<CollectorSummary> {
  const now = deps.now ?? Date.now;
  const deadline = now() + Math.min(20000, Math.max(1, deps.timeoutMs ?? 20000));
  let session: CollectorSession | undefined, owner: ClaudeAccountBaselineOwner | undefined;
  let progress = { dispatch: 0, page: 0, target: 0, marker: 0 };
  let fallback: CollectorCode = 'document-unavailable';
  let committed = false;
  const closeOwner = async () => {
    const handle = owner;
    owner = undefined;
    await handle?.close();
  };
  try {
    const source = snapshotCollectorSource(deps.source);
    if (!source) return collectorSummary('invalid-message');
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
    fallback = 'owner-unavailable';
    await session.wait(async () => {
      owner = await (deps.openOwner ?? openClaudeAccountBaselineOwner)({
        timeoutMs: Math.min(5000, Math.max(1, deadline - now())),
      });
    });
    await session.verify();
    const previous = await session.wait(() => owner!.read());
    await session.verify();
    if (previous !== null)
      return collectorSummary(previous ? 'owner-already-seeded' : 'owner-preflight-unknown');
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
    const collectionId = newCollectionId();
    session.check();
    fallback = 'owner-outcome-unknown';
    // The absolute deadline requests abort. Only the native owner's terminal result says what won.
    const result = await owner!.createPaused(collectionId, admitted, session.controller.signal);
    // The owner alone verifies exact canonical bytes; also correlate its terminal receipt to this invocation.
    if (
      (result.kind !== 'created' && result.kind !== 'already-created') ||
      result.baseline?.collectionId !== collectionId
    )
      throw new CollectorStop('owner-outcome-unknown');
    committed = true;
    // Close starts synchronously; a slow/rejecting close must not erase commit truth.
    await session.wait(closeOwner);
    await session.verify();
    return collectorSummary('saved', progress);
  } catch (error) {
    const code = errorCode(error, fallback);
    if (committed) {
      const verifiedStop =
        code === 'deadline-exceeded'
          ? 'committed-verification-deadline'
          : code === 'navigation-changed'
            ? 'committed-context-changed'
            : 'committed-verification-unavailable';
      return collectorSummary(verifiedStop, progress);
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
