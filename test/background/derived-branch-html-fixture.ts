import {
  buildDerivedBranchHtmlArtifact,
  type DerivedBranchHtmlTarget,
} from '../../src/lib/derived-branch-presentation-contract';
import { sha256Hex } from '../../src/lib/sha256';
import type { ExtensionMessage } from '../../src/lib/types';
import { htmlMessage } from './derived-html-fixture';

export type BranchHtmlMessage = Extract<
  ExtensionMessage,
  { action: 'persistDerivedBranchHtmlPresentation' }
>;
export async function branchHtmlMessage(
  source: 'chatgpt' | 'deepseek' = 'chatgpt',
  target: DerivedBranchHtmlTarget = { role: 'leaf', ordinal: 1 }
): Promise<BranchHtmlMessage> {
  const current = await htmlMessage(source);
  return {
    ...current,
    action: 'persistDerivedBranchHtmlPresentation',
    artifact: await buildDerivedBranchHtmlArtifact(
      '<!doctype html><p>private synthetic ♥ 字</p>',
      target,
      { sourceCanonicalSha256: 'b'.repeat(64), assetBindingSha256: 'c'.repeat(64) },
      sha256Hex
    ),
  };
}
