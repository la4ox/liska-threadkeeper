import { type AnalyzeSnapshotsInput, type SnapshotAnalysisPlan } from './contracts';
import { buildSnapshotPlan, encodeSnapshotAnalysisPlan } from './plan';
import { errorCode, fail, prepareAnalysis } from './safe-input';
import { measureInventories, verifyInventories } from './verify';

export * from './contracts';
export { encodeSnapshotAnalysisPlan } from './plan';

/**
 * Explicit selected bytes only. This API has no discovery, persistence or
 * mutation capability and never establishes the absence of external backlinks.
 */
export async function analyzeSnapshots(
  input: AnalyzeSnapshotsInput
): Promise<SnapshotAnalysisPlan> {
  try {
    const prepared = prepareAnalysis(input);
    const snapshots = await measureInventories(prepared);
    await verifyInventories(snapshots, prepared);
    const plan = buildSnapshotPlan(snapshots, prepared.limits);
    encodeSnapshotAnalysisPlan(plan, prepared.limits.maxReportBytes);
    return plan;
  } catch (error) {
    fail(errorCode(error, 'invalid-request'));
  }
}
