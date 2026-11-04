import type { SelectedPresentationArtifact } from '../archive/presentation/presentation-contracts';

export type OutputOutcome = 'success' | 'failure' | 'unknown';

type DownloadArtifact = Pick<
  SelectedPresentationArtifact,
  'content' | 'format' | 'mediaType' | 'extension'
>;

export function presentationPreviewFilename(
  title: string | null,
  format: string,
  extension: string
): string {
  const stem = (title ?? '')
    .normalize('NFKC')
    // eslint-disable-next-line no-control-regex -- Windows filename controls must be replaced.
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 100)
    .replace(/[. ]+$/g, '');
  const safe =
    !stem || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(stem)
      ? `liska-selected-${format}`
      : stem;
  return `${safe}-selection.${extension}`;
}

export const textPreviewFilename = (title: string | null): string =>
  presentationPreviewFilename(title, 'text', 'txt');

export interface DownloadAttempt {
  readonly result: Promise<OutputOutcome>;
  dispose(): void;
}

export interface BinaryDownloadArtifact {
  readonly bytes: ArrayBuffer | Uint8Array;
  readonly format: string;
  readonly mediaType: string;
  readonly extension: string;
}

export interface BinaryDownloadReceipt {
  readonly outcome: OutputOutcome;
  readonly downloadId: number | null;
}

export interface BinaryDownloadAttempt {
  readonly result: Promise<BinaryDownloadReceipt>;
  dispose(): void;
}

/** Exact-ID browser observation for one privately owned Blob. */
function observeBlobDownload(blob: Blob, filename: string): BinaryDownloadAttempt {
  const url = URL.createObjectURL(blob);
  let finish!: (outcome: OutputOutcome) => void;
  let downloadId: number | undefined;
  let settled = false;
  const terminal = (state: string | undefined) => {
    if (state === 'complete') finish('success');
    else if (state === 'interrupted') finish('failure');
  };
  const changed = (delta: chrome.downloads.DownloadDelta) => {
    if (delta.id === downloadId) terminal(delta.state?.current);
  };
  let timer: ReturnType<typeof setTimeout>;
  const result = new Promise<BinaryDownloadReceipt>(resolve => {
    finish = outcome => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(changed);
      URL.revokeObjectURL(url);
      resolve({ outcome, downloadId: downloadId ?? null });
    };
    timer = setTimeout(() => finish('unknown'), 120_000);
    try {
      chrome.downloads.onChanged.addListener(changed);
      chrome.downloads.download({ url, filename, saveAs: true }, id => {
        if (settled) return;
        if (chrome.runtime.lastError || !Number.isSafeInteger(id) || (id as number) < 0) {
          finish('unknown');
          return;
        }
        downloadId = id;
        // A terminal event can precede the callback. Read back this one ID only.
        void Promise.resolve()
          .then(() => (settled ? [] : chrome.downloads.search({ id })))
          .then(
            items => {
              if (!settled) terminal(items.find(item => item.id === id)?.state);
            },
            () => {
              if (!settled) finish('unknown');
            }
          );
      });
    } catch {
      finish('unknown');
    }
  });
  return { result, dispose: () => finish('unknown') };
}

/** One attempt; private Blob ownership ends at a terminal or unknown outcome. */
export function downloadSelectedPresentation(
  artifact: DownloadArtifact,
  title: string | null
): DownloadAttempt {
  const attempt = observeBlobDownload(
    new Blob([artifact.content], { type: `${artifact.mediaType};charset=utf-8` }),
    presentationPreviewFilename(title, artifact.format, artifact.extension)
  );
  return { result: attempt.result.then(receipt => receipt.outcome), dispose: attempt.dispose };
}

/** One exact-byte binary attempt; MIME is never rewritten with a text charset. */
export function downloadSelectedBinary(
  artifact: BinaryDownloadArtifact,
  title: string | null
): BinaryDownloadAttempt {
  const ownedBytes =
    artifact.bytes instanceof Uint8Array
      ? Uint8Array.from(artifact.bytes).buffer
      : artifact.bytes.slice(0);
  return observeBlobDownload(
    new Blob([ownedBytes], { type: artifact.mediaType }),
    presentationPreviewFilename(title, artifact.format, artifact.extension)
  );
}

/** Compatibility adapter for callers that already hold the exact selected Text bytes. */
export const downloadSelectedText = (text: string, title: string | null): DownloadAttempt =>
  downloadSelectedPresentation(
    { content: text, format: 'text', mediaType: 'text/plain', extension: 'txt' },
    title
  );
