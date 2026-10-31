import fixtureIndex from 'virtual:official-zip-fixture-index';
import {
  createOfficialZipFileSource,
  OfficialZipFileError,
} from '../../../src/reconcile/official-zip-file';
import {
  openOfficialExportZip,
  OfficialZipError,
  type OfficialZipSelection,
  type OfficialZipSource,
} from '../../../src/reconcile/official-zip';
import './style.css';

type Status = 'PASS' | 'FAIL' | 'INCONCLUSIVE';
interface OutputExpectation {
  ordinal: number;
  shardIndex: number;
  bytes: number;
  sha256: string;
}
interface FixtureCase {
  id: string;
  bytes: number;
  sha256: string;
  expectedFailure: number;
  manifestStatus: 'verified-name-set' | 'absent-unverified';
  selectedExpandedBytes: number;
  selectedCompressedBytes: number;
  outputs: OutputExpectation[];
  payloadRanges: { start: number; end: number; method: number; deflateBytes: number }[];
  rangeChecks: { start: number; end: number; sha256: string }[];
}
interface FixtureIndex {
  schemaVersion: number;
  maxReadBytes: number;
  maxArchiveBytes: number;
  heartbeatMaxGapMs: number;
  abortMaxMs: number;
  pauseMs: number;
  postAbortMs: number;
  maxCaseMs: number;
  cases: FixtureCase[];
}
interface Row {
  id: string;
  status: Status;
  metrics: number[];
}
interface Ledger {
  starts: number;
  completed: number;
  maxBytes: number;
  payloadStartedBytes: number;
  payloadBytes: number;
  lateStarts: number;
  ranges: [number, number][];
}
const index = fixtureIndex as FixtureIndex;
const rows: Row[] = [];
const results = document.querySelector<HTMLTableSectionElement>('#results')!;
const phase = document.querySelector<HTMLParagraphElement>('#phase')!;
const overall = document.querySelector<HTMLHeadingElement>('#overall')!;
const receipt = document.querySelector<HTMLPreElement>('#receipt')!;
const select = document.querySelector<HTMLButtonElement>('#select')!;
const picker = document.querySelector<HTMLInputElement>('#files')!;
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const bounded = (n: number) => Math.min(0xffffffff, Math.max(0, Math.round(n * 100) / 100));

function assert(condition: unknown): asserts condition {
  if (!condition) throw new Error('synthetic-check-failed');
}

async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Whole-file allocation belongs ONLY to the separately labelled pre/postflight phases. */
async function hashFile(file: File): Promise<string> {
  // Both buffers are function-scoped and become unreachable when the digest settles.
  return digest(new Uint8Array(await file.arrayBuffer()));
}

function report(id: string, status: Status, metrics: number[] = []): void {
  assert(rows.length < 32 && /^[a-z0-9-]+$/.test(id));
  const row = { id, status, metrics: metrics.map(bounded) };
  rows.push(row);
  const tr = document.createElement('tr');
  tr.dataset.status = status;
  for (const value of [row.id, row.status, row.metrics.join(', ')]) {
    const td = document.createElement('td');
    td.textContent = value;
    tr.append(td);
  }
  results.append(tr);
}

async function preflight(files: File[]): Promise<Map<string, File>> {
  assert(files.length === index.cases.length);
  assert(
    files.reduce((n, file) => n + file.size, 0) === index.cases.reduce((n, c) => n + c.bytes, 0)
  );
  const identified = new Map<string, File>();
  for (const file of files) {
    // Neither names, MIME, picker order nor reconstructed Files confer identity.
    assert(file instanceof File && file.size <= index.maxArchiveBytes);
    const candidates = index.cases.filter(c => c.bytes === file.size);
    assert(candidates.length > 0);
    const hash = await hashFile(file);
    const match = candidates.find(c => c.sha256 === hash);
    assert(match && !identified.has(match.id));
    identified.set(match.id, file);
  }
  assert(identified.size === index.cases.length);
  // hashFile's whole-file buffers have no retained references before adapter measurement.
  return identified;
}

function tracked(file: File, fixture: FixtureCase) {
  const adapter = createOfficialZipFileSource(file);
  const ledger: Ledger = {
    starts: 0,
    completed: 0,
    maxBytes: 0,
    payloadStartedBytes: 0,
    payloadBytes: 0,
    lateStarts: 0,
    ranges: [],
  };
  const source: OfficialZipSource = {
    size: adapter.size,
    async readRange(start, end, signal) {
      ledger.starts++;
      if (signal.aborted) ledger.lateStarts++;
      ledger.maxBytes = Math.max(ledger.maxBytes, end - start);
      for (const range of fixture.payloadRanges) {
        ledger.payloadStartedBytes += Math.max(
          0,
          Math.min(end, range.end) - Math.max(start, range.start)
        );
      }
      if (ledger.ranges.length < 256) ledger.ranges.push([start, end]);
      assert(end - start <= index.maxReadBytes);
      const bytes = await adapter.readRange(start, end, signal);
      ledger.completed++;
      for (const range of fixture.payloadRanges) {
        ledger.payloadBytes += Math.max(0, Math.min(end, range.end) - Math.max(start, range.start));
      }
      return bytes;
    },
  };
  return { source, ledger };
}

function streams(selection: OfficialZipSelection) {
  if (selection.officialChunks) return [{ shardIndex: -1, chunks: selection.officialChunks }];
  return selection.officialSources;
}

function isZipError(error: unknown, code: 'aborted' | 'inflate-failed'): boolean {
  return (
    error instanceof OfficialZipError &&
    error.code === code &&
    error.message === `Official ZIP source failed (${code}).`
  );
}

function isFileAbort(error: unknown): boolean {
  return (
    error instanceof OfficialZipFileError &&
    error.code === 'aborted' &&
    error.message === 'Official ZIP file failed (aborted).'
  );
}

async function withDeadline<T>(work: (controller: AbortController) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), index.maxCaseMs);
  try {
    return await work(controller);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function drain(
  iterator: AsyncIterator<Uint8Array>,
  expected: OutputExpectation,
  first?: IteratorResult<Uint8Array>
): Promise<{ bytes: number; chunks: number; retained: number }> {
  const parts: Uint8Array[] = [];
  const retained: { original: Uint8Array; snapshot: Uint8Array }[] = [];
  let bytes = 0;
  let next = first ?? (await iterator.next());
  while (!next.done) {
    assert(next.value instanceof Uint8Array && next.value.length > 0);
    assert(next.value.length <= index.maxReadBytes);
    bytes += next.value.length;
    assert(bytes <= expected.bytes);
    // Retain actual yielded references, not replacements, across later iterator advances.
    parts.push(next.value);
    if (retained.length < 8)
      retained.push({ original: next.value, snapshot: new Uint8Array(next.value) });
    next = await iterator.next();
  }
  assert(bytes === expected.bytes);
  for (const part of retained) {
    assert(part.original.length === part.snapshot.length);
    assert(part.original.every((byte, i) => byte === part.snapshot[i]));
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  assert((await digest(joined)) === expected.sha256);
  return { bytes, chunks: parts.length, retained: retained.length };
}

async function ranges(file: File, fixture: FixtureCase): Promise<void> {
  const source = createOfficialZipFileSource(file);
  const signal = new AbortController().signal;
  let checks = 0;
  for (const range of fixture.rangeChecks) {
    const bytes = await source.readRange(range.start, range.end, signal);
    assert(bytes.length === range.end - range.start);
    assert((await digest(bytes)) === range.sha256);
    checks++;
  }
  const first = await source.readRange(0, 16, signal);
  const second = await source.readRange(0, 16, signal);
  assert(first.buffer !== second.buffer);
  const original = second[0];
  first[0] ^= 255;
  assert(second[0] === original);
  const third = await source.readRange(0, 16, signal);
  assert(third[0] === original);
  report('direct-ranges-owned-buffers', 'PASS', [checks, source.size]);
}

async function nativeCase(file: File, fixture: FixtureCase): Promise<void> {
  const { source, ledger } = tracked(file, fixture);
  let bytes = 0;
  let chunks = 0;
  let retained = 0;
  try {
    await withDeadline(async controller => {
      const selection = await openOfficialExportZip({ source, signal: controller.signal });
      assert(selection.evidence.manifestStatus === fixture.manifestStatus);
      assert(selection.evidence.selectedCompressedBytes === fixture.selectedCompressedBytes);
      assert(selection.evidence.selectedExpandedBytes === fixture.selectedExpandedBytes);
      const selected = streams(selection);
      assert(selected.length === fixture.outputs.length);
      for (let i = 0; i < selected.length; i++) {
        assert(selected[i].shardIndex === fixture.outputs[i].shardIndex);
        assert(fixture.outputs[i].ordinal === i);
        const result = await drain(selected[i].chunks[Symbol.asyncIterator](), fixture.outputs[i]);
        bytes += result.bytes;
        chunks += result.chunks;
        retained += result.retained;
      }
    });
    assert(!fixture.expectedFailure);
  } catch (error) {
    if (!fixture.expectedFailure || !isZipError(error, 'inflate-failed')) throw error;
  }
  assert(ledger.maxBytes <= index.maxReadBytes && ledger.lateStarts === 0);
  report(fixture.id, 'PASS', [
    ledger.starts,
    ledger.completed,
    ledger.maxBytes,
    bytes,
    chunks,
    retained,
  ]);
}

async function preAbort(file: File, fixture: FixtureCase): Promise<void> {
  const controller = new AbortController();
  controller.abort('synthetic-reason-not-reported');
  const { source, ledger } = tracked(file, fixture);
  let rejected = false;
  try {
    await openOfficialExportZip({ source, signal: controller.signal });
  } catch (error) {
    rejected = isZipError(error, 'aborted');
  }
  assert(rejected && ledger.starts === 0);
  rejected = false;
  try {
    await createOfficialZipFileSource(file).readRange(0, 16, controller.signal);
  } catch (error) {
    rejected = isFileAbort(error);
  }
  assert(rejected);
  report('pre-abort-zero-source-reads', 'PASS', [ledger.starts]);
}

async function pausedConsumer(file: File, fixture: FixtureCase): Promise<void> {
  await withDeadline(async controller => {
    const { source, ledger } = tracked(file, fixture);
    const selection = await openOfficialExportZip({ source, signal: controller.signal });
    const iterator = streams(selection)[0].chunks[Symbol.asyncIterator]();
    const first = await iterator.next();
    assert(!first.done);
    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      await delay(index.pauseMs / 5);
      samples.push(ledger.starts);
    }
    const plateau = samples.slice(-3).every(n => n === samples[4]);
    const payload = fixture.payloadRanges[0];
    const beforeEof = ledger.payloadStartedBytes < payload.end - payload.start;
    const pausedBytes = ledger.payloadBytes;
    const resumed = await drain(iterator, fixture.outputs[0], first);
    assert(ledger.maxBytes <= index.maxReadBytes);
    report('native-paused-consumer-resumed', plateau && beforeEof ? 'PASS' : 'INCONCLUSIVE', [
      ...samples,
      pausedBytes,
      payload.end - payload.start,
      resumed.bytes,
      resumed.retained,
    ]);
  });
}

async function activeAbort(file: File, fixture: FixtureCase): Promise<void> {
  await withDeadline(async controller => {
    const { source, ledger } = tracked(file, fixture);
    const selection = await openOfficialExportZip({ source, signal: controller.signal });
    const iterator = streams(selection)[0].chunks[Symbol.asyncIterator]();
    const first = await iterator.next();
    assert(!first.done);
    const retained = new Uint8Array(first.value);
    const pending = iterator.next();
    const started = performance.now();
    controller.abort('synthetic-reason-not-reported');
    const startsAtAbort = ledger.starts;
    let rejected = false;
    let outputGrowth = 0;
    try {
      const result = await pending;
      if (!result.done) outputGrowth++;
    } catch (error) {
      rejected = isZipError(error, 'aborted');
    }
    const abortMs = performance.now() - started;
    await delay(index.postAbortMs);
    assert(rejected && outputGrowth === 0 && abortMs <= index.abortMaxMs);
    assert(ledger.starts === startsAtAbort && ledger.lateStarts === 0);
    assert(first.value.every((byte, i) => byte === retained[i]));
    report('native-active-abort-no-growth', 'PASS', [
      abortMs,
      startsAtAbort,
      ledger.starts,
      outputGrowth,
      ledger.lateStarts,
    ]);
  });
}

/** Delays an injected source, NOT a native File read. This is explicitly synthetic evidence. */
async function syntheticPendingAbort(file: File, fixture: FixtureCase): Promise<void> {
  await withDeadline(async controller => {
    const { source: adapter, ledger } = tracked(file, fixture);
    let delayPayload = false;
    let delayedStarts = 0;
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const pendingRead = new Promise<void>(resolve => {
      entered = resolve;
    });
    const source: OfficialZipSource = {
      size: adapter.size,
      async readRange(start, end, signal) {
        if (delayPayload) {
          delayedStarts++;
          entered();
          await gate;
          // Native adapter is never started once this synthetic delayed request is aborted.
          if (signal.aborted) throw new Error('synthetic-delayed-abort');
        }
        return adapter.readRange(start, end, signal);
      },
    };
    try {
      const selection = await openOfficialExportZip({ source, signal: controller.signal });
      delayPayload = true;
      const iterator = streams(selection)[0].chunks[Symbol.asyncIterator]();
      const pending = iterator.next();
      await Promise.race([
        pendingRead,
        pending.then(() => {
          throw new Error('synthetic-pending-read-not-observed');
        }),
      ]);
      const starts = ledger.starts;
      const started = performance.now();
      controller.abort();
      let rejected = false;
      try {
        await pending;
      } catch (error) {
        rejected = isZipError(error, 'aborted');
      }
      const abortMs = performance.now() - started;
      release();
      await delay(index.postAbortMs);
      assert(rejected && abortMs <= index.abortMaxMs);
      assert(delayedStarts === 1 && ledger.starts === starts);
      report('synthetic-delayed-source-pending-abort', 'PASS', [
        abortMs,
        delayedStarts,
        starts,
        ledger.starts,
      ]);
    } finally {
      release();
    }
  });
}

function heartbeat() {
  const start = performance.now();
  let lastTimer = start;
  let lastFrame = start;
  let timerMax = 0;
  let frameMax = 0;
  let timers = 0;
  let frames = 0;
  let hidden = document.visibilityState !== 'visible';
  let raf = 0;
  const visibility = () => {
    hidden ||= document.visibilityState !== 'visible';
  };
  document.addEventListener('visibilitychange', visibility);
  const timer = setInterval(() => {
    const now = performance.now();
    timerMax = Math.max(timerMax, now - lastTimer);
    lastTimer = now;
    timers++;
  }, 20);
  const animate = (now: number) => {
    frameMax = Math.max(frameMax, now - lastFrame);
    lastFrame = now;
    frames++;
    raf = requestAnimationFrame(animate);
  };
  raf = requestAnimationFrame(animate);
  return () => {
    const now = performance.now();
    timerMax = Math.max(timerMax, now - lastTimer);
    frameMax = Math.max(frameMax, now - lastFrame);
    clearInterval(timer);
    cancelAnimationFrame(raf);
    document.removeEventListener('visibilitychange', visibility);
    const status =
      hidden || !timers || !frames
        ? 'INCONCLUSIVE'
        : Math.max(timerMax, frameMax) <= index.heartbeatMaxGapMs
          ? 'PASS'
          : 'FAIL';
    report('measured-timer-animation-heartbeat', status, [
      timerMax,
      frameMax,
      index.heartbeatMaxGapMs,
      timers,
      frames,
    ]);
  };
}

async function attempt(id: string, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    report(
      id,
      error instanceof OfficialZipError && error.code === 'inflater-unavailable'
        ? 'INCONCLUSIVE'
        : 'FAIL'
    );
  }
}

async function run(files: File[]): Promise<void> {
  let preflightMs = 0;
  let measuredMs = 0;
  let postflightMs = 0;
  let identified: Map<string, File> | undefined;
  try {
    phase.textContent = 'Preflight: whole-file SHA-256 (outside adapter measurement).';
    const started = performance.now();
    identified = await preflight(files);
    preflightMs = performance.now() - started;
    files.length = 0;
    report('preflight-size-sha256-original-files', 'PASS', [identified.size, preflightMs]);
    phase.textContent =
      'Measured adapter/native phase: bounded ranges, native streams, pause, abort, heartbeat.';
    await delay(50);
    const measuredStart = performance.now();
    const stopHeartbeat = heartbeat();
    try {
      const small = index.cases[0];
      const large = index.cases.find(c => c.id === 'large-deflate')!;
      await attempt('direct-ranges-owned-buffers', () => ranges(identified!.get(small.id)!, small));
      for (const fixture of index.cases) {
        await attempt(fixture.id, () => nativeCase(identified!.get(fixture.id)!, fixture));
      }
      await attempt('pre-abort-zero-source-reads', () =>
        preAbort(identified!.get(small.id)!, small)
      );
      await attempt('native-paused-consumer-resumed', () =>
        pausedConsumer(identified!.get(large.id)!, large)
      );
      await attempt('native-active-abort-no-growth', () =>
        activeAbort(identified!.get(large.id)!, large)
      );
      await attempt('synthetic-delayed-source-pending-abort', () =>
        syntheticPendingAbort(identified!.get(large.id)!, large)
      );
      await delay(50);
    } finally {
      stopHeartbeat();
      measuredMs = performance.now() - measuredStart;
    }
    phase.textContent = 'Postflight: whole-file SHA-256 (outside adapter measurement).';
    const postStart = performance.now();
    await attempt('postflight-all-file-hashes-unchanged', async () => {
      for (const fixture of index.cases) {
        assert((await hashFile(identified!.get(fixture.id)!)) === fixture.sha256);
      }
      report('postflight-all-file-hashes-unchanged', 'PASS', [identified!.size]);
    });
    postflightMs = performance.now() - postStart;
  } catch {
    report('preflight-size-sha256-original-files', 'FAIL');
  } finally {
    files.length = 0;
    identified?.clear();
    const status: Status = rows.some(row => row.status === 'FAIL')
      ? 'FAIL'
      : rows.some(row => row.status === 'INCONCLUSIVE')
        ? 'INCONCLUSIVE'
        : 'PASS';
    overall.textContent = status;
    overall.dataset.status = status;
    phase.textContent =
      'Finished. Metrics: read starts/completions/max bytes, output bytes/chunks/retained, or timings/counts.';
    // Only fixed IDs, fixed statuses, indexed hashes and capped numbers cross the UI boundary.
    receipt.textContent = JSON.stringify(
      {
        status,
        preflightHashMs: bounded(preflightMs),
        measuredMs: bounded(measuredMs),
        postflightHashMs: bounded(postflightMs),
        rows,
        indexedFixtureHashes: index.cases.map(c => ({ id: c.id, sha256: c.sha256 })),
      },
      null,
      2
    );
  }
}

select.addEventListener('click', () => picker.click());
picker.addEventListener(
  'change',
  () => {
    const files = Array.from(picker.files ?? []);
    picker.value = '';
    if (!files.length) return;
    select.disabled = true;
    // One explicit picker selection; no automatic reruns, retained FileList or side effects.
    void run(files);
  },
  { once: true }
);
