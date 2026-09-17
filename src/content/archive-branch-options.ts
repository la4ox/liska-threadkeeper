import type {
  ArchiveBlock,
  ArchiveBranchCatalog,
  ArchiveBranchDescriptor,
  ArchiveMessage,
  LiskaThreadArchive,
} from '../archive';
import type { ArchiveBranchPickerOption } from './ui';
import { sanitizeHtml } from '../lib/sanitize';

const BRANCH_PREVIEW_LIMIT = 280;
const BRANCH_PREVIEW_SCAN_LIMIT = 8_192;

function compactPreview(value: string): string | undefined {
  const compact = value.slice(0, BRANCH_PREVIEW_SCAN_LIMIT).replace(/\s+/g, ' ').trim();
  if (!compact) return undefined;
  return compact.length > BRANCH_PREVIEW_LIMIT
    ? `${compact.slice(0, BRANCH_PREVIEW_LIMIT - 1)}…`
    : compact;
}

function blockPreview(block: ArchiveBlock): string | undefined {
  switch (block.type) {
    case 'text':
      return compactPreview(block.text);
    case 'markdown':
      return compactPreview(block.markdown);
    case 'code':
      return compactPreview(block.code);
    case 'quote':
      return compactPreview(block.text);
    case 'html': {
      const parsed = new DOMParser().parseFromString(
        sanitizeHtml(block.html.slice(0, BRANCH_PREVIEW_SCAN_LIMIT)),
        'text/html'
      );
      return compactPreview(parsed.body.textContent ?? '');
    }
    default:
      return undefined;
  }
}

function messagePreview(message: ArchiveMessage): string | undefined {
  for (const block of message.blocks) {
    const preview = blockPreview(block);
    if (preview) return preview;
  }
  return undefined;
}

function firstUniquePreview(
  archive: LiskaThreadArchive,
  branch: ArchiveBranchDescriptor
): string | undefined {
  const messages = branch.uniqueNodeIds.flatMap(nodeId => {
    const message = archive.graph.nodes[nodeId]?.message;
    return message && message.visibility !== 'hidden' ? [message] : [];
  });
  const conversational = messages.filter(
    message => message.author.role === 'user' || message.author.role === 'assistant'
  );
  for (const message of conversational) {
    const preview = messagePreview(message);
    if (preview) return preview;
  }
  return undefined;
}

function uniqueMessageCount(archive: LiskaThreadArchive, branch: ArchiveBranchDescriptor): number {
  return branch.uniqueNodeIds.reduce(
    (count, nodeId) => count + (archive.graph.nodes[nodeId]?.message ? 1 : 0),
    0
  );
}

function pickerOption(
  archive: LiskaThreadArchive,
  branch: ArchiveBranchDescriptor
): ArchiveBranchPickerOption {
  const preview = firstUniquePreview(archive, branch);
  return {
    ordinal: branch.ordinal,
    messageCount: branch.messageCount,
    uniqueMessageCount: uniqueMessageCount(archive, branch),
    isCurrent: branch.isCurrentLeaf,
    ...(preview ? { preview } : {}),
  };
}

/** Build local display-only choices; provider node IDs stay in the catalog. */
export function buildArchiveBranchPickerOptions(
  archive: LiskaThreadArchive,
  catalog: ArchiveBranchCatalog
): ArchiveBranchPickerOption[] {
  return catalog.branches
    .map(branch => pickerOption(archive, branch))
    .sort((left, right) => Number(right.isCurrent) - Number(left.isCurrent));
}
