import {
  snapshotChatGptDestinationArchiveReceipt,
  type ChatGptDestinationArchiveReceipt,
} from '../lib/chatgpt-archive-receipt';
import { generateHash } from '../lib/hash';
import type { ObsidianNote } from '../lib/types';

function captureScopedFileName(fileName: string, captureId: string): string {
  const stem = fileName.toLowerCase().endsWith('.md') ? fileName.slice(0, -3) : fileName;
  return `${stem}--capture-${captureId.slice(-36).toLowerCase()}.md`;
}

function decorateNote(
  note: ObsidianNote,
  snapshot: ChatGptDestinationArchiveReceipt,
  fileName: string,
  captureLevel = false
): ObsidianNote {
  const targets = [
    ...new Set(
      snapshot.assets.map(
        asset =>
          `_liska-archive/${snapshot.conversationKey}/${snapshot.captureId}/${asset.relativePath}`
      )
    ),
  ].sort();
  const links = targets.map((target, index) => {
    const extension = target.slice(target.lastIndexOf('.') + 1);
    return `- [Attachment ${index + 1} (${extension})](${target})`;
  });
  const body =
    links.length === 0
      ? note.body
      : `${note.body}${note.body ? '\n\n' : ''}## Local archive attachments\n\n${
          captureLevel ? 'Capture-level files; branch membership is not asserted.\n\n' : ''
        }${links.join('\n')}`;

  return {
    ...note,
    fileName,
    frontmatter: {
      ...note.frontmatter,
      tags: [...note.frontmatter.tags],
      archive_capture_id: snapshot.captureId,
      archive_manifest_sha256: snapshot.manifestSha256,
    },
    ...(note.images && { images: note.images.map(image => ({ ...image })) }),
    body,
    contentHash: generateHash(body),
  };
}

/** Add only destination-confirmed, content-addressed archive links. */
export function decorateChatGptArchiveNote(note: ObsidianNote, receipt: unknown): ObsidianNote {
  const snapshot = snapshotChatGptDestinationArchiveReceipt(receipt);
  if (!snapshot) throw new TypeError('Invalid ChatGPT destination archive receipt.');
  return decorateNote(note, snapshot, captureScopedFileName(note.fileName, snapshot.captureId));
}

/** Bind a prepared presentation without changing filenames referenced by its index. */
export function decorateChatGptArchivePresentation(
  note: ObsidianNote,
  receipt: unknown
): ObsidianNote {
  const snapshot = snapshotChatGptDestinationArchiveReceipt(receipt);
  if (
    !snapshot ||
    (note.frontmatter.presentation_mode !== 'all-branches-leaf' &&
      note.frontmatter.presentation_mode !== 'all-branches-index') ||
    note.frontmatter.archive_capture_id !== snapshot.captureId
  ) {
    throw new TypeError('Invalid ChatGPT presentation archive receipt.');
  }
  return decorateNote(note, snapshot, note.fileName, true);
}
