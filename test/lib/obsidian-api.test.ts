import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  ObsidianApiClient,
  ObsidianApiError,
  isObsidianApiError,
  classifyNetworkError,
  encodeVaultPath,
} from '../../src/lib/obsidian-api';
import { ARCHIVE_COMPANION_API_TIMEOUT_MS, DEFAULT_API_TIMEOUT } from '../../src/lib/constants';
import { getErrorMessage } from '../../src/lib/error-utils';

/**
 * Local REST API 4.1.3+ (GHSA-62gx-5q78-wrvx) splits the request path on
 * literal `/` and only then decodes each segment, so `%2F` is no longer a
 * directory separator. Paths must therefore be encoded per segment.
 */
describe('encodeVaultPath (issue #377)', () => {
  it('keeps directory separators literal', () => {
    expect(encodeVaultPath('AI/gemini/note.md')).toBe('AI/gemini/note.md');
  });

  it('percent-encodes spaces within a segment', () => {
    expect(encodeVaultPath('AI/Gemini/test file.md')).toBe('AI/Gemini/test%20file.md');
  });

  it('percent-encodes URL syntax characters that encodeURI would leave raw', () => {
    // encodeURI does not escape # ? & — they would truncate or corrupt the URL.
    expect(encodeVaultPath('AI/Q&A/notes#draft?x.md')).toBe('AI/Q%26A/notes%23draft%3Fx.md');
  });

  it('percent-encodes non-ASCII segments', () => {
    expect(encodeVaultPath('AI/ジェミニ/メモ.md')).toBe(
      `AI/${encodeURIComponent('ジェミニ')}/${encodeURIComponent('メモ')}.md`
    );
  });

  it('percent-encodes a literal % so the server round-trips it', () => {
    expect(encodeVaultPath('AI/100%/note.md')).toBe('AI/100%25/note.md');
  });

  it('passes through a bare filename with no separators', () => {
    expect(encodeVaultPath('note.md')).toBe('note.md');
  });

  it('returns an empty string unchanged', () => {
    expect(encodeVaultPath('')).toBe('');
  });
});

describe('ObsidianApiClient', () => {
  let client: ObsidianApiClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    client = new ObsidianApiClient('http://127.0.0.1:27123', 'test-api-key');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('constructor', () => {
    it('constructs with base URL and API key', () => {
      const client = new ObsidianApiClient('http://127.0.0.1:28000', 'my-key');
      mockFetch.mockResolvedValue({ ok: true, status: 200 });
      void client.testConnection();
      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:28000/vault/', expect.any(Object));
    });

    it('strips trailing slash from base URL', () => {
      const client = new ObsidianApiClient('https://192.168.1.5:27123/', 'my-key');
      mockFetch.mockResolvedValue({ ok: true, status: 200 });
      void client.testConnection();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://192.168.1.5:27123/vault/',
        expect.any(Object)
      );
    });

    it('works with https URL', () => {
      const client = new ObsidianApiClient('https://127.0.0.1:27123', 'my-key');
      mockFetch.mockResolvedValue({ ok: true, status: 200 });
      void client.testConnection();
      expect(mockFetch).toHaveBeenCalledWith('https://127.0.0.1:27123/vault/', expect.any(Object));
    });
  });

  describe('testConnection', () => {
    it('returns success when connection and authentication succeed', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      const result = await client.testConnection();

      expect(result).toEqual({
        reachable: true,
        authenticated: true,
      });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:27123/vault/',
        expect.objectContaining({
          method: 'GET',
          headers: { Authorization: 'Bearer test-api-key' },
        })
      );
    });

    it('returns authenticated:false when API key is invalid (401)', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 401 });

      const result = await client.testConnection();

      expect(result).toEqual({
        reachable: true,
        authenticated: false,
        error: 'Invalid API key',
      });
    });

    it('returns authenticated:false when API key is forbidden (403)', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 403 });

      const result = await client.testConnection();

      expect(result).toEqual({
        reachable: true,
        authenticated: false,
        error: 'Invalid API key',
      });
    });

    it('returns authenticated:false for other server errors', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      const result = await client.testConnection();

      expect(result).toEqual({
        reachable: true,
        authenticated: false,
        error: 'Server error: 500',
      });
    });

    it('returns reachable:false when network error occurs', async () => {
      mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

      const result = await client.testConnection();

      expect(result).toEqual({
        reachable: false,
        authenticated: false,
        error: 'Cannot reach Obsidian. Is it running?',
      });
    });

    it('returns timeout error when request times out', async () => {
      const timeoutError = new DOMException('The operation timed out', 'TimeoutError');
      mockFetch.mockRejectedValue(timeoutError);

      const result = await client.testConnection();

      expect(result).toEqual({
        reachable: false,
        authenticated: false,
        error: 'Connection timed out',
      });
    });
  });

  describe('getServerVersions', () => {
    const info = {
      status: 'OK',
      service: 'Obsidian Local REST API',
      authenticated: true,
      versions: { self: '5.5.0', obsidian: '1.14.4' },
    };

    it('returns only strict authenticated versions from the root endpoint', async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ ...info, state: { private: true } }))
      );
      await expect(client.getServerVersions(60_000)).resolves.toEqual(info.versions);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:27123/',
        expect.objectContaining({
          method: 'GET',
          redirect: 'error',
          credentials: 'omit',
          headers: { Authorization: 'Bearer test-api-key', Accept: 'application/json' },
        })
      );
    });

    it.each([
      { ...info, authenticated: false },
      { ...info, status: 'NOT-OK' },
      { ...info, service: 'Other' },
      { ...info, versions: { self: '5.5.0' } },
      { ...info, versions: { self: '5.5.0', obsidian: '1.14.4', extra: 'private' } },
      { ...info, versions: { self: {}, obsidian: '1.14.4' } },
    ])('rejects invalid capability facts without returning server data', async value => {
      mockFetch.mockResolvedValue(new Response(JSON.stringify(value)));
      await expect(client.getServerVersions()).rejects.toMatchObject({
        status: 0,
        message: 'Obsidian server information is invalid.',
      });
    });

    it('bounds root bytes and rejects invalid UTF-8 or non-200 responses', async () => {
      mockFetch.mockResolvedValueOnce(new Response(new Uint8Array(65_537)));
      await expect(client.getServerVersions()).rejects.toMatchObject({
        message: 'Obsidian response body exceeds its limit.',
      });
      mockFetch.mockResolvedValueOnce(new Response(new Uint8Array([255])));
      await expect(client.getServerVersions()).rejects.toMatchObject({
        message: 'Obsidian server information is invalid.',
      });
      mockFetch.mockResolvedValueOnce(new Response('{}', { status: 401 }));
      await expect(client.getServerVersions()).rejects.toMatchObject({ status: 401 });
    });

    it('keeps a caller timeout and normalizes connection failure', async () => {
      const timeout = vi.spyOn(AbortSignal, 'timeout');
      mockFetch.mockRejectedValue(new TypeError('private network error'));
      await expect(client.getServerVersions(4321)).rejects.toMatchObject({
        status: 0,
        message: 'Cannot reach Obsidian. Is it running?',
      });
      expect(timeout).toHaveBeenCalledWith(4321);
      timeout.mockRestore();
    });
  });

  describe('strict reconciliation binary methods', () => {
    it('uses create-only PUT with exact encoded path, byte body and timeout', async () => {
      const timeout = vi.spyOn(AbortSignal, 'timeout');
      const bytes = new Uint8Array([0, 255, 1]);
      mockFetch.mockResolvedValue(new Response(null, { status: 204 }));
      await client.putBinaryFileIfAbsent(
        'AI/Лис #1/archive.json',
        bytes,
        'application/octet-stream',
        60_000
      );
      expect(mockFetch).toHaveBeenCalledWith(
        `http://127.0.0.1:27123/vault/AI/${encodeURIComponent('Лис #1')}/archive.json`,
        expect.objectContaining({
          method: 'PUT',
          body: bytes,
          redirect: 'error',
          credentials: 'omit',
          headers: {
            Authorization: 'Bearer test-api-key',
            'Content-Type': 'application/octet-stream',
            'If-None-Match': '*',
          },
        })
      );
      expect(timeout).toHaveBeenCalledWith(60_000);
      timeout.mockRestore();
    });

    it('reports 412 without retrying or copying response prose', async () => {
      mockFetch.mockResolvedValue(new Response('private target name', { status: 412 }));
      await expect(
        client.putBinaryFileIfAbsent('a.json', new Uint8Array([1]), 'application/octet-stream')
      ).rejects.toMatchObject({
        status: 412,
        message: 'Obsidian create-only target already exists.',
      });
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('normalizes timeout and network failures on create-only writes', async () => {
      mockFetch.mockRejectedValueOnce(new DOMException('private', 'TimeoutError'));
      await expect(
        client.putBinaryFileIfAbsent('a.json', new Uint8Array(), 'application/octet-stream')
      ).rejects.toMatchObject({
        status: 0,
        message: 'Request timed out. Please check your connection.',
      });
      mockFetch.mockRejectedValueOnce(new TypeError('private'));
      await expect(
        client.putBinaryFileIfAbsent('a.json', new Uint8Array(), 'application/octet-stream')
      ).rejects.toMatchObject({ status: 0, message: 'Cannot reach Obsidian. Is it running?' });
    });

    it('checks occupied binary paths without reading or retaining their bodies', async () => {
      const cancel = vi.fn(async () => undefined);
      mockFetch.mockResolvedValueOnce({ status: 200, ok: true, body: { cancel } });
      await expect(client.binaryFileExists('a.json', 60_000)).resolves.toBe(true);
      expect(cancel).toHaveBeenCalledOnce();
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
      await expect(client.binaryFileExists('missing.json')).resolves.toBe(false);
      expect(mockFetch).toHaveBeenLastCalledWith(
        'http://127.0.0.1:27123/vault/missing.json',
        expect.objectContaining({ method: 'GET', redirect: 'error', credentials: 'omit' })
      );
    });

    it('reads exact binary bytes with a strict size ceiling', async () => {
      mockFetch.mockResolvedValueOnce(new Response(new Uint8Array([0, 255, 1])));
      await expect(client.getBinaryFileBounded('a.json', 3, 60_000)).resolves.toEqual(
        new Uint8Array([0, 255, 1])
      );
      mockFetch.mockResolvedValueOnce(new Response(new Uint8Array([0, 255, 1])));
      await expect(client.getBinaryFileBounded('a.json', 2)).rejects.toMatchObject({
        message: 'Obsidian response body exceeds its limit.',
      });
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
      await expect(client.getBinaryFileBounded('missing.json', 0)).resolves.toBeNull();
    });

    it('rejects redirected root, binary preflight, create and readback responses', async () => {
      const response = { status: 200, ok: true, redirected: true, body: { cancel: vi.fn() } };
      mockFetch.mockResolvedValue(response);
      await expect(client.getServerVersions()).rejects.toBeInstanceOf(ObsidianApiError);
      await expect(client.binaryFileExists('a.json')).rejects.toBeInstanceOf(ObsidianApiError);
      await expect(
        client.putBinaryFileIfAbsent('a.json', new Uint8Array(), 'application/octet-stream')
      ).rejects.toBeInstanceOf(ObsidianApiError);
      await expect(client.getBinaryFileBounded('a.json', 3)).rejects.toBeInstanceOf(
        ObsidianApiError
      );
    });
  });

  describe('getFile', () => {
    it('returns file content when file exists', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('# File Content'),
      });

      const content = await client.getFile('path/to/file.md');

      expect(content).toBe('# File Content');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:27123/vault/path/to/file.md',
        expect.any(Object)
      );
    });

    it('returns null when file does not exist (404)', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      const content = await client.getFile('non-existent.md');

      expect(content).toBeNull();
    });

    it('throws error for other status codes', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(client.getFile('path/to/file.md')).rejects.toMatchObject({
        status: 500,
        message: 'Failed to get file: Internal Server Error',
      });
    });

    it('throws connection error for TypeError (connection refused)', async () => {
      mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(client.getFile('path/to/file.md')).rejects.toMatchObject({
        status: 0,
        message: 'Cannot reach Obsidian. Is it running?',
      });
    });

    it('throws abort error for AbortError', async () => {
      const abortError = new DOMException('The operation was aborted', 'AbortError');
      mockFetch.mockRejectedValue(abortError);

      await expect(client.getFile('path/to/file.md')).rejects.toMatchObject({
        status: 0,
        message: 'Request was cancelled.',
      });
    });

    it('normalizes a connection failure while reading the response body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.reject(new TypeError('Body stream failed')),
      });

      const error = await client.getFile('path/to/file.md').catch(value => value);

      expect(error).toBeInstanceOf(ObsidianApiError);
      expect(error).toMatchObject({
        status: 0,
        message: 'Cannot reach Obsidian. Is it running?',
      });
    });

    it('normalizes a synchronous transport failure from the body reader', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => {
          throw new TypeError('Body reader failed synchronously');
        },
      });

      await expect(client.getFile('path/to/file.md')).rejects.toMatchObject({
        status: 0,
        message: 'Cannot reach Obsidian. Is it running?',
      });
    });

    it('preserves an unknown body parser error unchanged', async () => {
      const malformed = new SyntaxError('Malformed body');
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.reject(malformed),
      });

      await expect(client.getFile('path/to/file.md')).rejects.toBe(malformed);
    });

    it('encodes path correctly', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('content'),
      });

      await client.getFile('AI/Gemini/test file.md');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:27123/vault/AI/Gemini/test%20file.md',
        expect.any(Object)
      );
    });
  });

  describe('getBinaryFile', () => {
    it('returns exact response bytes for archive write verification', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(new Uint8Array([0, 255, 1]).buffer),
      });

      const bytes = await client.getBinaryFile('AI/chatgpt/archive.json');

      expect(Array.from(bytes ?? [])).toEqual([0, 255, 1]);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:27123/vault/AI/chatgpt/archive.json',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('uses the five-second default timeout unless an archive budget is supplied', async () => {
      const timeout = vi
        .spyOn(AbortSignal, 'timeout')
        .mockImplementation(() => new AbortController().signal);
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(new Uint8Array([1]).buffer),
      });

      await client.getBinaryFile('AI/chatgpt/default-timeout.json');

      expect(timeout).toHaveBeenCalledWith(DEFAULT_API_TIMEOUT);
      timeout.mockRestore();
    });

    it('allows an archive readback that completes after five seconds but before its archive timeout', async () => {
      vi.useFakeTimers();
      const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(timeoutMs => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), timeoutMs);
        return controller.signal;
      });
      mockFetch.mockImplementation(
        (_url: string, options: RequestInit) =>
          new Promise((resolve, reject) => {
            const signal = options.signal;
            const complete = setTimeout(() => {
              signal?.removeEventListener('abort', abort);
              resolve({
                ok: true,
                status: 200,
                arrayBuffer: () => Promise.resolve(new Uint8Array([1]).buffer),
              });
            }, DEFAULT_API_TIMEOUT + 1);
            const abort = () => {
              clearTimeout(complete);
              reject(new DOMException('The operation timed out', 'TimeoutError'));
            };
            signal?.addEventListener('abort', abort, { once: true });
          })
      );

      const readBack = client.getBinaryFile(
        'AI/chatgpt/archive-readback.json',
        ARCHIVE_COMPANION_API_TIMEOUT_MS
      );
      await vi.advanceTimersByTimeAsync(DEFAULT_API_TIMEOUT + 1);

      await expect(readBack).resolves.toEqual(new Uint8Array([1]));
      expect(timeout).toHaveBeenCalledWith(ARCHIVE_COMPANION_API_TIMEOUT_MS);
      timeout.mockRestore();
      vi.useRealTimers();
    });

    it('returns null for a missing binary archive companion', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 });
      await expect(client.getBinaryFile('missing.json')).resolves.toBeNull();
    });

    it('normalizes a timeout while reading exact binary bytes', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: () =>
          Promise.reject(new DOMException('The operation timed out', 'TimeoutError')),
      });

      await expect(client.getBinaryFile('archive.json')).rejects.toMatchObject({
        status: 0,
        message: 'Request timed out. Please check your connection.',
      });
    });
  });

  describe('putFile', () => {
    it('creates or updates file successfully', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      await client.putFile('path/to/file.md', '# New Content');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:27123/vault/path/to/file.md',
        expect.objectContaining({
          method: 'PUT',
          headers: {
            Authorization: 'Bearer test-api-key',
            'Content-Type': 'text/markdown',
          },
          body: '# New Content',
        })
      );
    });

    it('throws error for failed response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      });

      await expect(client.putFile('path/to/file.md', 'content')).rejects.toMatchObject({
        status: 403,
        message: 'Failed to save file: Forbidden',
      });
    });

    it('throws connection error for TypeError (connection refused)', async () => {
      mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(client.putFile('path/to/file.md', 'content')).rejects.toMatchObject({
        status: 0,
        message: 'Cannot reach Obsidian. Is it running?',
      });
    });

    it('throws timeout error for TimeoutError', async () => {
      const timeoutError = new DOMException('The operation timed out', 'TimeoutError');
      mockFetch.mockRejectedValue(timeoutError);

      await expect(client.putFile('path/to/file.md', 'content')).rejects.toMatchObject({
        status: 0,
        message: 'Request timed out. Please check your connection.',
      });
    });
  });

  describe('putBinaryFile', () => {
    it('PUTs binary bytes with the given content type', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });
      const bytes = new Uint8Array([0x50, 0x4e, 0x47]);

      await client.putBinaryFile('AI/gemini/images/a-img-1.png', bytes, 'image/png');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:27123/vault/AI/gemini/images/a-img-1.png',
        expect.objectContaining({
          method: 'PUT',
          headers: {
            Authorization: 'Bearer test-api-key',
            'Content-Type': 'image/png',
          },
          body: bytes,
        })
      );
    });

    it('uses the five-second default timeout when a binary write has no override', async () => {
      const timeout = vi
        .spyOn(AbortSignal, 'timeout')
        .mockImplementation(() => new AbortController().signal);
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      await client.putBinaryFile(
        'AI/gemini/images/default-timeout.png',
        new Uint8Array([1]),
        'image/png'
      );

      expect(timeout).toHaveBeenCalledWith(DEFAULT_API_TIMEOUT);
      timeout.mockRestore();
    });

    it('throws error for failed response', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' });

      await expect(
        client.putBinaryFile('x.png', new Uint8Array([1]), 'image/png')
      ).rejects.toMatchObject({ status: 500 });
    });
  });

  describe('listFiles', () => {
    it('returns file list for existing directory', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ files: ['note1.md', 'note2.md', 'subdir/'] }),
      });

      const files = await client.listFiles('AI/claude');

      expect(files).toEqual(['note1.md', 'note2.md']);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:27123/vault/AI/claude/',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Accept: 'application/json',
          }),
        })
      );
    });

    it('returns empty array for non-existent directory (404)', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      const files = await client.listFiles('nonexistent');

      expect(files).toEqual([]);
    });

    it('filters out directories from response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ files: ['note.md', 'images/', 'another.md', 'docs/'] }),
      });

      const files = await client.listFiles('AI');

      expect(files).toEqual(['note.md', 'another.md']);
    });

    it('throws error for server errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(client.listFiles('AI')).rejects.toMatchObject({
        status: 500,
        message: 'Failed to list files: Internal Server Error',
      });
    });

    it('throws connection error for TypeError (connection refused)', async () => {
      mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(client.listFiles('AI')).rejects.toMatchObject({
        status: 0,
        message: 'Cannot reach Obsidian. Is it running?',
      });
    });

    it('filters out non-string elements from files array (Q1)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ files: ['note.md', 42, null, 'other.md', true] }),
      });

      const files = await client.listFiles('AI');

      expect(files).toEqual(['note.md', 'other.md']);
    });
  });

  describe('listEntries', () => {
    it('returns files AND directory markers (no filtering)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ files: ['2026/', '2025/', 'README.md', 'old-chat-abc12345.md'] }),
      });

      const entries = await client.listEntries('AI/gemini');

      expect(entries).toEqual(['2026/', '2025/', 'README.md', 'old-chat-abc12345.md']);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:27123/vault/AI/gemini/',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Accept: 'application/json',
          }),
        })
      );
    });

    it('returns empty array for non-existent directory (404)', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      const entries = await client.listEntries('nonexistent');

      expect(entries).toEqual([]);
    });

    it('throws error for server errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(client.listEntries('AI')).rejects.toMatchObject({
        status: 500,
      });
    });

    it('filters out non-string elements but preserves directory entries', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ files: ['2026/', 42, null, 'note.md', true] }),
      });

      const entries = await client.listEntries('AI');

      expect(entries).toEqual(['2026/', 'note.md']);
    });

    it('normalizes an abort while reading a directory response body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new DOMException('The operation was aborted', 'AbortError')),
      });

      await expect(client.listEntries('AI')).rejects.toMatchObject({
        status: 0,
        message: 'Request was cancelled.',
      });
    });
  });

  describe('AbortSignal.timeout fallback', () => {
    it('uses fallback when AbortSignal.timeout is not available', async () => {
      // Save original AbortSignal.timeout
      const originalTimeout = AbortSignal.timeout;

      // Remove AbortSignal.timeout to trigger fallback
      // @ts-expect-error - intentionally removing for test
      delete AbortSignal.timeout;

      // Re-import the module to use the fallback path
      vi.resetModules();
      const { ObsidianApiClient: FreshClient } = await import('../../src/lib/obsidian-api');

      const freshMockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', freshMockFetch);

      const freshClient = new FreshClient('http://127.0.0.1:27123', 'test-key');
      await freshClient.testConnection();

      // Verify fetch was called with an AbortSignal to /vault/ endpoint
      expect(freshMockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:27123/vault/',
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );

      // Restore AbortSignal.timeout
      AbortSignal.timeout = originalTimeout;
    });
  });
});

describe('ObsidianApiError', () => {
  it('extends Error with name and status', () => {
    const error = new ObsidianApiError(404, 'Not found');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ObsidianApiError);
    expect(error.name).toBe('ObsidianApiError');
    expect(error.status).toBe(404);
    expect(error.message).toBe('Not found');
    expect(error.stack).toBeDefined();
  });
});

describe('isObsidianApiError', () => {
  it('returns true for ObsidianApiError instance', () => {
    expect(isObsidianApiError(new ObsidianApiError(404, 'Not found'))).toBe(true);
  });

  it('returns false for plain object with status and message', () => {
    expect(isObsidianApiError({ status: 404, message: 'Not found' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isObsidianApiError(null)).toBe(false);
  });

  it('returns false for non-object', () => {
    expect(isObsidianApiError('error')).toBe(false);
    expect(isObsidianApiError(123)).toBe(false);
  });

  it('returns false for generic Error', () => {
    expect(isObsidianApiError(new Error('test'))).toBe(false);
  });
});

describe('getErrorMessage', () => {
  it('returns message for network error (status 0)', () => {
    const error = new ObsidianApiError(0, 'Timeout');
    expect(getErrorMessage(error)).toBe(
      'Obsidian REST API is not running. Please ensure Obsidian is open and the Local REST API plugin is enabled.'
    );
  });

  it('returns message for auth error (status 401)', () => {
    const error = new ObsidianApiError(401, 'Unauthorized');
    expect(getErrorMessage(error)).toBe('Invalid API key. Please check your settings.');
  });

  it('returns message for auth error (status 403)', () => {
    const error = new ObsidianApiError(403, 'Forbidden');
    expect(getErrorMessage(error)).toBe('Invalid API key. Please check your settings.');
  });

  it('returns message for not found error (status 404)', () => {
    const error = new ObsidianApiError(404, 'Not Found');
    expect(getErrorMessage(error)).toBe('File not found in vault.');
  });

  it('returns original message for other status codes', () => {
    const error = new ObsidianApiError(500, 'Internal Server Error');
    expect(getErrorMessage(error)).toBe('Internal Server Error');
  });

  it('returns Error.message for Error instances', () => {
    const error = new Error('Something went wrong');
    expect(getErrorMessage(error)).toBe('Something went wrong');
  });

  it('returns stringified value for unknown error types', () => {
    // getErrorMessage now uses extractErrorMessage as fallback which stringifies the value
    expect(getErrorMessage('string error')).toBe('string error');
    expect(getErrorMessage(123)).toBe('123');
    expect(getErrorMessage(null)).toBe('null');
    expect(getErrorMessage(undefined)).toBe('undefined');
  });
});

describe('classifyNetworkError', () => {
  it('returns "abort" for DOMException with name AbortError', () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    const result = classifyNetworkError(abortError);
    expect(result).toBe('abort');
  });
});
