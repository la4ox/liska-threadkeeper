export type OutputOutcome = 'success' | 'failure' | 'unknown';

export function textPreviewFilename(title: string | null): string {
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
      ? 'liska-selected-text'
      : stem;
  return `${safe}-selection.txt`;
}

export interface DownloadAttempt {
  readonly result: Promise<OutputOutcome>;
  dispose(): void;
}

/** One attempt; private Blob ownership ends at a terminal or unknown outcome. */
export function downloadSelectedText(text: string, title: string | null): DownloadAttempt {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
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
      chrome.downloads.download({ url, filename: textPreviewFilename(title), saveAs: true }, id => {
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
              if (!settled) terminal(items[0]?.state);
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
