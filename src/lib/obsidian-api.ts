/**
 * Obsidian Local REST API client
 * API docs: https://github.com/coddingtonbear/obsidian-local-rest-api
 */

import { DEFAULT_API_TIMEOUT } from './constants';

/**
 * Network error type classification
 */
type NetworkErrorType = 'connection' | 'timeout' | 'abort' | 'unknown';

/**
 * Classify the type of network error
 *
 * @param error - The caught error
 * @returns The classified error type
 */
export function classifyNetworkError(error: unknown): NetworkErrorType {
  // TypeError: Failed to fetch (Chrome)
  // TypeError: NetworkError when attempting to fetch resource (Firefox)
  if (error instanceof TypeError) {
    return 'connection';
  }

  // DOMException handling
  if (error instanceof DOMException) {
    // TimeoutError: AbortSignal.timeout() triggered
    if (error.name === 'TimeoutError') {
      return 'timeout';
    }
    // AbortError: User-initiated abort or AbortController.abort()
    if (error.name === 'AbortError') {
      return 'abort';
    }
  }

  return 'unknown';
}

/**
 * Create an AbortSignal with timeout
 * Polyfill for AbortSignal.timeout() (Chrome < 103 support)
 *
 * Memory safety: If fetch completes before the timer, the setTimeout
 * callback may remain pending, but the controller will be GC'd,
 * so no memory leak occurs.
 */
function createTimeoutSignal(ms: number): AbortSignal {
  // Use native API on Chrome 103+
  if ('timeout' in AbortSignal) {
    return AbortSignal.timeout(ms);
  }
  // Fallback for Chrome < 103
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/**
 * Encode a vault path for the `/vault/{path}` endpoints.
 *
 * Directory separators MUST stay literal. Local REST API 4.1.3+ fixed a path
 * traversal vulnerability (GHSA-62gx-5q78-wrvx) by splitting the request path
 * on literal `/` and only then decoding each segment, so a percent-encoded
 * slash is no longer a separator — `AI%2Fgemini%2Fnote.md` is read as a single
 * file named `AI/gemini/note.md`, which 404s (issue #377).
 *
 * Each segment is still encoded with `encodeURIComponent`, not `encodeURI`:
 * vault paths are free-form user input and `encodeURI` leaves `#`, `?` and `&`
 * raw, which would truncate or corrupt the request URL.
 *
 * @param path - Path relative to vault root (e.g. `AI/gemini/note.md`)
 * @returns The same path with each segment percent-encoded
 */
export function encodeVaultPath(path: string): string {
  return path
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

export class ObsidianApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ObsidianApiError';
    this.status = status;
  }
}

export interface ObsidianServerVersions {
  self: string;
  obsidian: string;
}

const SERVER_INFO_MAX_BYTES = 64 * 1024;

function serverVersions(value: unknown): ObsidianServerVersions | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const root = value as Record<string, unknown>;
  if (
    !['status', 'service', 'authenticated', 'versions'].every(key =>
      Object.prototype.hasOwnProperty.call(root, key)
    ) ||
    root.status !== 'OK' ||
    root.service !== 'Obsidian Local REST API' ||
    root.authenticated !== true ||
    typeof root.versions !== 'object' ||
    root.versions === null ||
    Array.isArray(root.versions)
  )
    return undefined;
  return versionPair(root.versions as Record<string, unknown>);
}

function versionPair(versions: Record<string, unknown>): ObsidianServerVersions | undefined {
  if (
    Object.keys(versions).sort().join(',') !== 'obsidian,self' ||
    typeof versions.self !== 'string' ||
    typeof versions.obsidian !== 'string' ||
    !/^[0-9A-Za-z.+-]{1,64}$/.test(versions.self) ||
    !/^[0-9A-Za-z.+-]{1,64}$/.test(versions.obsidian)
  )
    return undefined;
  return { self: versions.self, obsidian: versions.obsidian };
}

export class ObsidianApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
  }

  /**
   * Get authorization headers
   */
  private getHeaders(): HeadersInit {
    return {
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  /** Convert every recognized transport failure to the same stable API error. */
  private rethrowNetworkError(error: unknown): never {
    const errorType = classifyNetworkError(error);
    if (errorType !== 'unknown') {
      const message =
        errorType === 'timeout'
          ? 'Request timed out. Please check your connection.'
          : errorType === 'connection'
            ? 'Cannot reach Obsidian. Is it running?'
            : 'Request was cancelled.';
      throw this.createError(0, message);
    }
    throw error;
  }

  /** Keep the timeout/network contract active after response headers resolve. */
  private async readResponseBody<T>(read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (error) {
      this.rethrowNetworkError(error);
    }
  }

  /**
   * Fetch with timeout and unified network error handling.
   * Wraps fetch() with AbortSignal.timeout and converts network errors
   * to ObsidianApiError. Used by getFile, putFile, listFiles.
   *
   * Not used by testConnection (which returns a result object instead of throwing).
   */
  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeoutMs = DEFAULT_API_TIMEOUT
  ): Promise<Response> {
    try {
      return await fetch(url, {
        ...options,
        signal: createTimeoutSignal(timeoutMs),
      });
    } catch (error) {
      this.rethrowNetworkError(error);
    }
  }

  /** Strict bounded body read for reconciliation capability checks and readback. */
  private async readBoundedBytes(response: Response, maximum: number): Promise<Uint8Array> {
    if (!response.body) throw this.createError(0, 'Obsidian response body is unavailable.');
    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const next = await this.readResponseBody(() => reader.read());
        if (next.done) break;
        size += next.value.byteLength;
        if (size > maximum) throw this.createError(0, 'Obsidian response body exceeds its limit.');
        parts.push(next.value.slice());
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) {
        bytes.set(part, offset);
        offset += part.byteLength;
      }
      return bytes;
    } finally {
      try {
        await reader.cancel();
      } catch {
        // A failed read or terminal stream still releases its reader below.
      }
      reader.releaseLock();
    }
  }

  /** Authenticated root capability snapshot; no account/plugin state is returned. */
  async getServerVersions(timeoutMs = DEFAULT_API_TIMEOUT): Promise<ObsidianServerVersions> {
    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/`,
      {
        method: 'GET',
        headers: { ...this.getHeaders(), Accept: 'application/json' },
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
      },
      timeoutMs
    );
    if (response.status !== 200 || !response.ok || response.redirected)
      throw this.createError(response.status, 'Obsidian server information is unavailable.');
    const bytes = await this.readBoundedBytes(response, SERVER_INFO_MAX_BYTES);
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      throw this.createError(0, 'Obsidian server information is invalid.');
    }
    const versions = serverVersions(parsed);
    if (!versions) throw this.createError(0, 'Obsidian server information is invalid.');
    return versions;
  }

  /** Credential-bound, redirect-refusing read with an explicit retained-byte cap. */
  async getBinaryFileBounded(
    path: string,
    maxBytes: number,
    timeoutMs = DEFAULT_API_TIMEOUT
  ): Promise<Uint8Array | null> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
      throw this.createError(0, 'Obsidian response byte limit is invalid.');
    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/vault/${encodeVaultPath(path)}`,
      {
        method: 'GET',
        headers: this.getHeaders(),
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
      },
      timeoutMs
    );
    if (response.redirected) throw this.createError(0, 'Obsidian binary response was redirected.');
    if (response.status === 404) return null;
    if (response.status !== 200 || !response.ok)
      throw this.createError(response.status, 'Obsidian binary read failed.');
    return this.readBoundedBytes(response, maxBytes);
  }

  /** Binary GET existence check without allocating an already-occupied file body. */
  async binaryFileExists(path: string, timeoutMs = DEFAULT_API_TIMEOUT): Promise<boolean> {
    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/vault/${encodeVaultPath(path)}`,
      {
        method: 'GET',
        headers: { ...this.getHeaders(), Accept: 'application/octet-stream' },
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
      },
      timeoutMs
    );
    try {
      if (response.redirected)
        throw this.createError(0, 'Obsidian binary response was redirected.');
      if (response.status === 404) return false;
      if (response.status !== 200 || !response.ok)
        throw this.createError(response.status, 'Obsidian binary preflight failed.');
      return true;
    } finally {
      try {
        await response.body?.cancel();
      } catch {
        // Headers already establish existence; no existing content is retained.
      }
    }
  }

  /** Create-only exact-byte write. Requires Local REST API 5.5+ capability admission. */
  async putBinaryFileIfAbsent(
    path: string,
    data: Uint8Array,
    contentType: string,
    timeoutMs = DEFAULT_API_TIMEOUT
  ): Promise<void> {
    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/vault/${encodeVaultPath(path)}`,
      {
        method: 'PUT',
        headers: {
          ...this.getHeaders(),
          'Content-Type': contentType,
          'If-None-Match': '*',
        },
        body: data as BodyInit,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
      },
      timeoutMs
    );
    if (response.status === 412)
      throw this.createError(412, 'Obsidian create-only target already exists.');
    if (!response.ok || response.redirected)
      throw this.createError(response.status, 'Obsidian create-only write failed.');
  }

  /**
   * Test API connection with authentication verification
   *
   * Uses /vault/ endpoint which requires authentication.
   * This ensures the API key is validated, not just server reachability.
   */
  async testConnection(): Promise<{
    /** Server is reachable */
    reachable: boolean;
    /** API Key is valid (authentication succeeded) */
    authenticated: boolean;
    /** Error message (when failed) */
    error?: string;
  }> {
    try {
      const response = await fetch(`${this.baseUrl}/vault/`, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: createTimeoutSignal(DEFAULT_API_TIMEOUT),
      });

      // Authentication error
      if (response.status === 401 || response.status === 403) {
        return {
          reachable: true,
          authenticated: false,
          error: 'Invalid API key',
        };
      }

      // Other server errors
      if (!response.ok) {
        return {
          reachable: true,
          authenticated: false,
          error: `Server error: ${response.status}`,
        };
      }

      // Success
      return {
        reachable: true,
        authenticated: true,
      };
    } catch (error) {
      // Network error
      const errorType = classifyNetworkError(error);
      return {
        reachable: false,
        authenticated: false,
        error:
          errorType === 'timeout'
            ? 'Connection timed out'
            : 'Cannot reach Obsidian. Is it running?',
      };
    }
  }

  /**
   * Get file content from vault
   * @param path - Path relative to vault root (e.g., "AI/Gemini/conversation.md")
   * @returns File content as string, or null if file doesn't exist
   */
  async getFile(path: string): Promise<string | null> {
    const encodedPath = encodeVaultPath(path);
    const response = await this.fetchWithTimeout(`${this.baseUrl}/vault/${encodedPath}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw this.createError(response.status, `Failed to get file: ${response.statusText}`);
    }

    return await this.readResponseBody(() => response.text());
  }

  /**
   * Read exact binary bytes from a vault file. Archive companions use this
   * after a PUT so success means the vault returned the expected byte hash,
   * not merely that it accepted the request.
   */
  async getBinaryFile(path: string, timeoutMs = DEFAULT_API_TIMEOUT): Promise<Uint8Array | null> {
    const encodedPath = encodeVaultPath(path);
    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/vault/${encodedPath}`,
      {
        method: 'GET',
        headers: this.getHeaders(),
      },
      timeoutMs
    );

    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw this.createError(response.status, `Failed to get file: ${response.statusText}`);
    }
    return new Uint8Array(await this.readResponseBody(() => response.arrayBuffer()));
  }

  /**
   * Create or update file in vault
   * @param path - Path relative to vault root
   * @param content - File content (markdown)
   */
  async putFile(path: string, content: string): Promise<void> {
    const encodedPath = encodeVaultPath(path);
    const response = await this.fetchWithTimeout(`${this.baseUrl}/vault/${encodedPath}`, {
      method: 'PUT',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'text/markdown',
      },
      body: content,
    });

    if (!response.ok) {
      throw this.createError(response.status, `Failed to save file: ${response.statusText}`);
    }
  }

  /**
   * Create or update a binary file in the vault (e.g. an image).
   * @param path - Path relative to vault root
   * @param data - Raw bytes to write
   * @param contentType - MIME type (e.g. "image/png")
   */
  async putBinaryFile(
    path: string,
    data: Uint8Array,
    contentType: string,
    timeoutMs = DEFAULT_API_TIMEOUT
  ): Promise<void> {
    const encodedPath = encodeVaultPath(path);
    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/vault/${encodedPath}`,
      {
        method: 'PUT',
        headers: {
          ...this.getHeaders(),
          'Content-Type': contentType,
        },
        // Uint8Array is a valid BufferSource body; the cast placates the DOM
        // lib's narrower BodyInit typing across ArrayBufferLike variants.
        body: data as BodyInit,
      },
      timeoutMs
    );

    if (!response.ok) {
      throw this.createError(response.status, `Failed to save image: ${response.statusText}`);
    }
  }

  /**
   * List files in a vault directory.
   * Uses GET /vault/{directory}/ endpoint.
   * Returns empty array if directory doesn't exist (404).
   *
   * @param directory - Directory path relative to vault root
   * @returns Array of filenames (directories filtered out)
   */
  async listFiles(directory: string): Promise<string[]> {
    const entries = await this.listEntries(directory);
    return entries.filter(f => !f.endsWith('/'));
  }

  /**
   * List entries in a vault directory, including subdirectory markers.
   * Subdirectory entries end with a trailing `/` (Obsidian Local REST API convention).
   *
   * Used by append-mode recursive scan when the vault path template contains
   * date variables — the scan walks subdirectories from the search base.
   *
   * @param directory - Directory path relative to vault root
   * @returns Array of entry names; directories carry a trailing `/`
   */
  async listEntries(directory: string): Promise<string[]> {
    const encodedDir = encodeVaultPath(directory);
    const response = await this.fetchWithTimeout(`${this.baseUrl}/vault/${encodedDir}/`, {
      method: 'GET',
      headers: {
        ...this.getHeaders(),
        Accept: 'application/json',
      },
    });

    if (response.status === 404) {
      return [];
    }

    if (!response.ok) {
      throw this.createError(response.status, `Failed to list files: ${response.statusText}`);
    }

    const data = (await this.readResponseBody(() => response.json())) as Record<string, unknown>;
    const rawFiles = Array.isArray(data?.files) ? data.files : [];
    return rawFiles.filter((f): f is string => typeof f === 'string');
  }

  /**
   * Create an API error
   */
  private createError(status: number, message: string): ObsidianApiError {
    return new ObsidianApiError(status, message);
  }
}

/**
 * Type guard for ObsidianApiError
 */
export function isObsidianApiError(error: unknown): error is ObsidianApiError {
  return error instanceof ObsidianApiError;
}

// getErrorMessage moved to src/lib/error-utils.ts for centralization
