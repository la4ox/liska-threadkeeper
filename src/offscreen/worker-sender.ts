/** Authenticate worker messages without runtime.getManifest (unavailable offscreen). */

export type WorkerSenderFailure =
  | 'offscreen-sender-extension'
  | 'offscreen-sender-tab'
  | 'offscreen-sender-document'
  | 'offscreen-sender-url'
  | 'offscreen-worker-entry-unavailable';

type SenderCheck = WorkerSenderFailure | undefined;
type WorkerSenderCheck = (
  sender: chrome.runtime.MessageSender
) => SenderCheck | Promise<SenderCheck>;

const MANIFEST_READ_TIMEOUT_MS = 3000;

function packagedWorkerUrl(manifest: unknown, manifestUrl: URL): string | undefined {
  if (typeof manifest !== 'object' || manifest === null) return undefined;
  const background = (manifest as { background?: unknown }).background;
  if (typeof background !== 'object' || background === null) return undefined;
  const worker = (background as { service_worker?: unknown }).service_worker;
  if (typeof worker !== 'string' || worker.length === 0) return undefined;
  const url = new URL(worker, manifestUrl);
  if (
    url.protocol !== manifestUrl.protocol ||
    url.host !== manifestUrl.host ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    return undefined;
  }
  return url.href;
}

async function readPackagedWorkerUrl(): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MANIFEST_READ_TIMEOUT_MS);
  try {
    // Only this installed package is consulted, never a URL supplied in a message.
    const manifestUrl = new URL(chrome.runtime.getURL('manifest.json'));
    const response = await fetch(manifestUrl.href, {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    return packagedWorkerUrl(await response.json(), manifestUrl);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** Each offscreen document reads its own packaged worker entry at most once. */
export function createWorkerSenderCheck(): WorkerSenderCheck {
  let workerUrl: Promise<string | undefined> | undefined;
  return sender => {
    if (sender.id !== chrome.runtime.id) return 'offscreen-sender-extension';
    if (sender.tab !== undefined) return 'offscreen-sender-tab';
    if (sender.documentId !== undefined) return 'offscreen-sender-document';
    if (sender.url === undefined) return undefined;
    workerUrl ??= readPackagedWorkerUrl();
    return workerUrl.then(expected => {
      if (!expected) return 'offscreen-worker-entry-unavailable';
      return sender.url === expected ? undefined : 'offscreen-sender-url';
    });
  };
}
