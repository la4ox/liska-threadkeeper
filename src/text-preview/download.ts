import type {
  PresentationFormat,
  SelectedPresentationArtifact,
} from '../archive/presentation/presentation-contracts';

export type OutputOutcome = 'success' | 'failure' | 'unknown';

type DownloadArtifact = Pick<
  SelectedPresentationArtifact,
  'content' | 'format' | 'mediaType' | 'extension'
>;

export function presentationPreviewFilename(
  title: string | null,
  format: PresentationFormat,
  extension: SelectedPresentationArtifact['extension']
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

/** One attempt; private Blob ownership ends at a terminal or unknown outcome. */
// eslint-disable-next-line max-lines-per-function -- Blob ownership, exact-ID terminal reconciliation and disposal share one attempt boundary.
export function downloadSelectedPresentation(
  artifact: DownloadArtifact,
  title: string | null
): DownloadAttempt {
  const url = URL.createObjectURL(
    new Blob([artifact.content], { type: `${artifact.mediaType};charset=utf-8` })
  );
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
  const result = new Promise<OutputOutcome>(resolve => {
    finish = outcome => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(changed);
      URL.revokeObjectURL(url);
      resolve(outcome);
    };
    timer = setTimeout(() => finish('unknown'), 120_000);
    try {
      chrome.downloads.onChanged.addListener(changed);
      chrome.downloads.download(
        {
          url,
          filename: presentationPreviewFilename(title, artifact.format, artifact.extension),
          saveAs: true,
        },
        id => {
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
        }
      );
    } catch {
      finish('unknown');
    }
  });
  return { result, dispose: () => finish('unknown') };
}

/** Compatibility adapter for callers that already hold the exact selected Text bytes. */
export const downloadSelectedText = (text: string, title: string | null): DownloadAttempt =>
  downloadSelectedPresentation(
    { content: text, format: 'text', mediaType: 'text/plain', extension: 'txt' },
    title
  );
