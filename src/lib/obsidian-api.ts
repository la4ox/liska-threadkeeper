/**
 * Obsidian Local REST API client
 * API docs: https://github.com/coddingtonbear/obsidian-local-rest-api
 */

import {
  DEFAULT_API_TIMEOUT,
  MAX_EXTENSION_MESSAGE_SIZE,
  MAX_STAGED_BINARY_ASSET_BYTES,
} from './constants';

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

export type ObsidianIdentityPhase = 'anonymous' | 'authenticated';
export type ObsidianIdentityFailure = 'identity' | 'authentication';

/**
 * A root response was received, but it did not establish the expected Local
 * REST API identity. Keeping this distinct from transport status 0 prevents a
 * malformed or unrelated loopback service from being reported as "not running".
 */
export class ObsidianIdentityError extends ObsidianApiError {
  readonly phase: ObsidianIdentityPhase;
  readonly failure: ObsidianIdentityFailure;

  constructor(
    phase: ObsidianIdentityPhase,
    status: number,
    message: string,
    failure: ObsidianIdentityFailure = 'identity'
  ) {
    super(status, message);
    this.name = 'ObsidianIdentityError';
    this.phase = phase;
    this.failure = failure;
  }
}

/** Allows exact-byte readback callers to retain their size-mismatch diagnostic. */
export class ObsidianResponseLimitError extends ObsidianApiError {
  constructor() {
    super(0, 'Obsidian response body exceeds its limit.');
    this.name = 'ObsidianResponseLimitError';
  }
}

export interface ObsidianServerVersions {
  self: string;
  obsidian: string;
}

const SERVER_INFO_MAX_BYTES = 64 * 1024;

// A persisted note includes generated frontmatter in addition to the admitted
// 32 MiB body. Use the existing 60 MiB serialized-message allowance so a valid
// saved note remains readable by collision/append probes and later exports.
const SERIALIZED_NOTE_MAX_BYTES = MAX_EXTENSION_MESSAGE_SIZE;

// Directory JSON uses a tighter 8 MiB wire/decoded allocation budget before
// JSON.parse, below the ordinary 32 MiB content contract. Post-parse validation
// caps lists at 100k entries and 8 Mi aggregate string code units; a single
// 1024-code-unit name already exceeds ordinary filesystem component limits.
const DIRECTORY_MAX_BYTES = 8 * 1024 * 1024;
const DIRECTORY_MAX_ENTRIES = 100_000;
const DIRECTORY_MAX_ENTRY_CODE_UNITS = 1024;
const DIRECTORY_MAX_STRING_CODE_UNITS = DIRECTORY_MAX_BYTES;

interface ObsidianServerIdentity {
  authenticated: boolean;
  versions: ObsidianServerVersions;
}

/** Local REST API 4.1.7–5.3 used `ok`; 5.4+ renamed it to `status`. */
function hasSuccessfulRootMarker(root: Record<string, unknown>): boolean {
  const hasLegacy = Object.prototype.hasOwnProperty.call(root, 'ok');
  const hasCurrent = Object.prototype.hasOwnProperty.call(root, 'status');
  if (!hasLegacy && !hasCurrent) return false;
  return (!hasLegacy || root.ok === 'OK') && (!hasCurrent || root.status === 'OK');
}

function serverIdentity(value: unknown): ObsidianServerIdentity | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const root = value as Record<string, unknown>;
  if (
    !['service', 'authenticated', 'versions'].every(key =>
      Object.prototype.hasOwnProperty.call(root, key)
    ) ||
    !hasSuccessfulRootMarker(root) ||
    root.service !== 'Obsidian Local REST API' ||
    typeof root.authenticated !== 'boolean' ||
    typeof root.versions !== 'object' ||
    root.versions === null ||
    Array.isArray(root.versions)
  )
    return undefined;
  const versions = versionPair(root.versions as Record<string, unknown>);
  if (!versions) return undefined;
  return { authenticated: root.authenticated, versions };
}

function versionPair(versions: Record<string, unknown>): ObsidianServerVersions | undefined {
  if (
    !['self', 'obsidian'].every(key => Object.prototype.hasOwnProperty.call(versions, key)) ||
    typeof versions.self !== 'string' ||
    typeof versions.obsidian !== 'string' ||
    !/^[0-9A-Za-z.+-]{1,64}$/.test(versions.self) ||
    !/^[0-9A-Za-z.+-]{1,64}$/.test(versions.obsidian)
  )
    return undefined;
  return { self: versions.self, obsidian: versions.obsidian };
}

const IDENTITY_INVALID_MESSAGE =
  'The configured API address did not return a valid Obsidian Local REST API response. Check the address and make sure Obsidian and the Local REST API plugin are running.';

function identityHttpError(phase: ObsidianIdentityPhase, status: number): ObsidianIdentityError {
  return new ObsidianIdentityError(
    phase,
    status,
    phase === 'anonymous'
      ? `The configured Obsidian API address returned HTTP ${status} before authentication.`
      : `Obsidian Local REST API returned HTTP ${status} while checking the API key.`,
    phase === 'authenticated' && (status === 401 || status === 403) ? 'authentication' : 'identity'
  );
}

function invalidIdentityError(
  phase: ObsidianIdentityPhase,
  message = IDENTITY_INVALID_MESSAGE
): ObsidianIdentityError {
  return new ObsidianIdentityError(phase, 0, message);
}

export class ObsidianApiClient {
  private baseUrl: string;
  private apiKey: string;
  private identityAdmission?: Promise<ObsidianServerVersions>;

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
   * to ObsidianApiError. Identity probes use it directly; credential-bound
   * methods use the admitted wrapper below.
   */
  private async fetchRawWithTimeout(
    url: string,
    options: RequestInit,
    timeoutMs = DEFAULT_API_TIMEOUT
  ): Promise<Response> {
    try {
      const response = await fetch(url, {
        ...options,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        signal: createTimeoutSignal(timeoutMs),
      });
      if (response.redirected) throw this.createError(0, 'Obsidian response was redirected.');
      return response;
    } catch (error) {
      this.rethrowNetworkError(error);
    }
  }

  /** Every credential-bound request waits for one endpoint-and-key-bound admission. */
  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeoutMs = DEFAULT_API_TIMEOUT
  ): Promise<Response> {
    await this.ensureServerIdentity(timeoutMs);
    return this.fetchRawWithTimeout(url, options, timeoutMs);
  }

  /** Retain only admitted stream bytes; never trust Content-Length for the cap. */
  private async readBoundedBytes(
    response: Response,
    maximum: number,
    allowEmptyBody = false
  ): Promise<Uint8Array> {
    const body = response.body;
    if (!body) {
      if (allowEmptyBody && body === null) return new Uint8Array();
      throw this.createError(0, 'Obsidian response body is unavailable.');
    }
    const reader = await this.readResponseBody(async () => body.getReader());
    // Coalesce chunks so even zero-/one-byte chunks cannot accumulate an
    // unbounded array of retained chunk objects. Capacity never exceeds the cap.
    let bytes = new Uint8Array();
    let size = 0;
    try {
      while (true) {
        const next = await this.readResponseBody(() => reader.read());
        if (next.done) break;
        const nextSize = size + next.value.byteLength;
        if (nextSize > maximum) throw new ObsidianResponseLimitError();
        if (nextSize > bytes.byteLength) {
          const capacity = Math.min(maximum, Math.max(nextSize, 64 * 1024, bytes.byteLength * 2));
          const grown = new Uint8Array(capacity);
          grown.set(bytes);
          bytes = grown;
        }
        bytes.set(next.value, size);
        size = nextSize;
      }
      return size === bytes.byteLength ? bytes : bytes.slice(0, size);
    } finally {
      try {
        await reader.cancel();
      } catch {
        // A failed read or terminal stream still releases its reader below.
      }
      reader.releaseLock();
    }
  }

  /** Parse one already-received root response without retaining server prose. */
  private async readServerIdentityResponse(
    response: Response,
    phase: ObsidianIdentityPhase,
    expectedAuthenticated: boolean
  ): Promise<ObsidianServerVersions> {
    if (response.status !== 200 || !response.ok || response.redirected) {
      try {
        await response.body?.cancel();
      } catch {
        // Status alone is authoritative; never retain or surface an error body.
      }
      throw identityHttpError(phase, response.status);
    }

    let bytes: Uint8Array;
    try {
      bytes = await this.readBoundedBytes(response, SERVER_INFO_MAX_BYTES);
    } catch (error) {
      if (
        error instanceof ObsidianResponseLimitError ||
        (error instanceof ObsidianApiError &&
          error.message === 'Obsidian response body is unavailable.')
      ) {
        throw invalidIdentityError(phase);
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      throw invalidIdentityError(phase);
    }
    const identity = serverIdentity(parsed);
    if (!identity) throw invalidIdentityError(phase);
    if (identity.authenticated !== expectedAuthenticated) {
      if (phase === 'authenticated' && !identity.authenticated) {
        throw new ObsidianIdentityError(
          phase,
          response.status,
          'Obsidian Local REST API rejected the API key.',
          'authentication'
        );
      }
      throw invalidIdentityError(phase);
    }
    return identity.versions;
  }

  /** Read and strictly validate one bounded root identity response. */
  private async probeServerIdentity(
    phase: ObsidianIdentityPhase,
    timeoutMs: number
  ): Promise<ObsidianServerVersions> {
    const expectedAuthenticated = phase === 'authenticated';
    try {
      const response = await this.fetchRawWithTimeout(
        `${this.baseUrl}/`,
        {
          method: 'GET',
          headers: expectedAuthenticated
            ? { ...this.getHeaders(), Accept: 'application/json' }
            : { Accept: 'application/json' },
        },
        timeoutMs
      );
      return await this.readServerIdentityResponse(response, phase, expectedAuthenticated);
    } catch (error) {
      if (
        error instanceof ObsidianApiError &&
        error.message === 'Obsidian response was redirected.'
      ) {
        throw invalidIdentityError(
          phase,
          'The configured Obsidian API address redirected the connection check.'
        );
      }
      throw error;
    }
  }

  /**
   * Admit this immutable endpoint/key pair once. A rejected admission remains
   * rejected for the client's lifetime so no sibling path can bypass it.
   */
  private async ensureServerIdentity(
    timeoutMs = DEFAULT_API_TIMEOUT
  ): Promise<ObsidianServerVersions> {
    this.identityAdmission ??= (async () => {
      const anonymous = await this.probeServerIdentity('anonymous', timeoutMs);
      const authenticated = await this.probeServerIdentity('authenticated', timeoutMs);
      if (anonymous.self !== authenticated.self || anonymous.obsidian !== authenticated.obsidian) {
        throw new ObsidianIdentityError(
          'authenticated',
          0,
          'Obsidian Local REST API changed between connection checks. Please try again.'
        );
      }
      return Object.freeze({ ...authenticated });
    })();
    const versions = await this.identityAdmission;
    return { ...versions };
  }

  /** Authenticated root capability snapshot; no account/plugin state is returned. */
  async getServerVersions(timeoutMs = DEFAULT_API_TIMEOUT): Promise<ObsidianServerVersions> {
    return this.ensureServerIdentity(timeoutMs);
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
   * Verifies the unauthenticated and authenticated root identities before any
   * vault request can carry the API key.
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
      await this.ensureServerIdentity(DEFAULT_API_TIMEOUT);
      return {
        reachable: true,
        authenticated: true,
      };
    } catch (error) {
      if (error instanceof ObsidianIdentityError) {
        if (error.failure === 'authentication') {
          return {
            reachable: true,
            authenticated: false,
            error: 'Invalid API key',
          };
        }
        if (error.status > 0 && !(error.status === 401 || error.status === 403)) {
          return {
            reachable: true,
            authenticated: false,
            error: `Server error: ${error.status}`,
          };
        }
        return {
          reachable: true,
          authenticated: false,
          error: error.message,
        };
      }
      // Network error
      const errorType = classifyNetworkError(error);
      const timedOut =
        errorType === 'timeout' ||
        (error instanceof ObsidianApiError &&
          error.message === 'Request timed out. Please check your connection.');
      return {
        reachable: false,
        authenticated: false,
        error: timedOut ? 'Connection timed out' : 'Cannot reach Obsidian. Is it running?',
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

    const bytes = await this.readBoundedBytes(response, SERIALIZED_NOTE_MAX_BYTES, true);
    return new TextDecoder().decode(bytes);
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
    return this.readBoundedBytes(response, MAX_STAGED_BINARY_ASSET_BYTES, true);
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

    const bytes = await this.readBoundedBytes(response, DIRECTORY_MAX_BYTES);
    let data: unknown;
    try {
      data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      throw this.createError(0, 'Obsidian directory response is invalid.');
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data))
      throw this.createError(0, 'Obsidian directory response is invalid.');
    const files: unknown = (data as Record<string, unknown>).files;
    if (!Array.isArray(files) || files.length > DIRECTORY_MAX_ENTRIES)
      throw this.createError(0, 'Obsidian directory response is invalid.');
    let stringCodeUnits = 0;
    for (const entry of files) {
      if (
        typeof entry !== 'string' ||
        entry.length === 0 ||
        entry.length > DIRECTORY_MAX_ENTRY_CODE_UNITS
      )
        throw this.createError(0, 'Obsidian directory response is invalid.');
      stringCodeUnits += entry.length;
      if (stringCodeUnits > DIRECTORY_MAX_STRING_CODE_UNITS)
        throw this.createError(0, 'Obsidian directory response is invalid.');
    }
    return files as string[];
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
