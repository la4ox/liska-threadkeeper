import { CLAUDE_ACCOUNT_BASELINE_OWNER_STORE } from './database';
import {
  ClaudeAccountBaselineOwnerError,
  type ClaudeAccountBaselineOwnerErrorCode,
} from './errors';

export interface OwnerTransaction<Output> {
  readonly store: IDBObjectStore;
  isAborting(): boolean;
  request<Value>(request: IDBRequest<Value>, onSuccess: (value: Value) => void): void;
  finish(value: Output): void;
}

/** Own the operation through a terminal event; abort() alone never settles truth. */
class TransactionSession<Output> {
  private terminal = false;
  private abortRequested = false;
  private output?: { value: Output };
  private timer: ReturnType<typeof setTimeout>;
  readonly outcome: Promise<Output>;
  private resolve!: (value: Output) => void;
  private reject!: (error: ClaudeAccountBaselineOwnerError) => void;

  constructor(
    private readonly transaction: IDBTransaction,
    private readonly timeoutMs: number,
    private readonly fence: () => void,
    private readonly signal?: AbortSignal
  ) {
    this.outcome = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    this.timer = setTimeout(this.abort, this.timeoutMs);
    transaction.oncomplete = () => (this.output ? this.complete(this.output) : this.unknown());
    transaction.onabort = () =>
      this.complete(new ClaudeAccountBaselineOwnerError('transaction-aborted'));
    transaction.onerror = this.abort;
    signal?.addEventListener('abort', this.abort, { once: true });
  }

  private complete(result: { value: Output } | ClaudeAccountBaselineOwnerError): void {
    if (this.terminal) return;
    this.terminal = true;
    clearTimeout(this.timer);
    this.signal?.removeEventListener('abort', this.abort);
    if (result instanceof ClaudeAccountBaselineOwnerError) this.reject(result);
    else this.resolve(result.value);
  }

  private readonly unknown = (): void => {
    if (this.terminal) return;
    this.complete(new ClaudeAccountBaselineOwnerError('transaction-outcome-unknown'));
    this.fence();
  };

  readonly abort = (): void => {
    if (this.terminal || this.abortRequested) return;
    this.abortRequested = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(this.unknown, this.timeoutMs);
    try {
      this.transaction.abort();
    } catch {
      // Already committing or ending; wait for the actual complete/abort event.
    }
  };

  private request<Value>(request: IDBRequest<Value>, onSuccess: (value: Value) => void): void {
    request.onerror = this.abort;
    request.onsuccess = () => {
      if (this.terminal) return;
      try {
        onSuccess(request.result);
      } catch {
        this.abort();
      }
    };
  }

  run(action: (context: OwnerTransaction<Output>) => void): void {
    try {
      if (this.signal?.aborted) return this.abort();
      action({
        store: this.transaction.objectStore(CLAUDE_ACCOUNT_BASELINE_OWNER_STORE),
        isAborting: () => this.abortRequested,
        request: (request, onSuccess) => this.request(request, onSuccess),
        finish: value => {
          this.output = { value };
        },
      });
    } catch {
      this.abort();
    }
  }
}

function begin(database: IDBDatabase, mode: 'readonly' | 'readwrite'): IDBTransaction {
  if (mode === 'readonly') return database.transaction(CLAUDE_ACCOUNT_BASELINE_OWNER_STORE, mode);
  try {
    return database.transaction(CLAUDE_ACCOUNT_BASELINE_OWNER_STORE, mode, {
      durability: 'strict',
    });
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return database.transaction(CLAUDE_ACCOUNT_BASELINE_OWNER_STORE, mode);
  }
}

export class OwnerConnection {
  private reason?: ClaudeAccountBaselineOwnerErrorCode;
  private readonly pending = new Map<Promise<unknown>, () => void>();

  constructor(
    private readonly database: IDBDatabase,
    private readonly timeoutMs: number
  ) {
    database.onversionchange = () => this.stop('version-changed');
    database.onclose = () => this.stop('closed');
  }

  private stop(reason: ClaudeAccountBaselineOwnerErrorCode): void {
    if (this.reason) return;
    this.reason = reason;
    for (const abort of this.pending.values()) abort();
    this.database.close();
  }

  async close(): Promise<void> {
    this.stop('closed');
    await Promise.allSettled(this.pending.keys());
  }

  async run<Output>(
    mode: 'readonly' | 'readwrite',
    action: (context: OwnerTransaction<Output>) => void,
    signal?: AbortSignal
  ): Promise<Output> {
    if (this.reason) throw new ClaudeAccountBaselineOwnerError(this.reason);
    if (signal?.aborted) throw new ClaudeAccountBaselineOwnerError('transaction-aborted');
    let transaction: IDBTransaction;
    try {
      transaction = begin(this.database, mode);
    } catch {
      throw new ClaudeAccountBaselineOwnerError('transaction-aborted');
    }
    const session = new TransactionSession<Output>(
      transaction,
      this.timeoutMs,
      () => this.stop('transaction-outcome-unknown'),
      signal
    );
    this.pending.set(session.outcome, session.abort);
    session.run(action);
    try {
      return await session.outcome;
    } finally {
      this.pending.delete(session.outcome);
    }
  }
}
