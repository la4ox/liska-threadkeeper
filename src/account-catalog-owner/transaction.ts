import { OWNERS, SLOTS, STORES } from './database';
import { AccountCatalogError, type AccountCatalogErrorCode } from './errors';

export interface CatalogTransaction<Output> {
  readonly slots: IDBObjectStore;
  readonly owners: IDBObjectStore;
  request<Value>(request: IDBRequest<Value>, onSuccess: (value: Value) => void): void;
  finish(value: Output): void;
}

function asTransactionError(error: unknown): AccountCatalogError {
  if (error instanceof AccountCatalogError) return error;
  return new AccountCatalogError(
    error instanceof DOMException && error.name === 'QuotaExceededError'
      ? 'quota-exceeded'
      : 'transaction-aborted'
  );
}

function isAborted(signal: AbortSignal | undefined): boolean {
  if (signal === undefined) return false;
  try {
    // Do not evaluate caller-owned overrides of the platform signal.
    return Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!.call(signal);
  } catch {
    throw new AccountCatalogError('invalid-input');
  }
}

/** Only a terminal event, not a successful add or abort request, settles this session. */
class TransactionSession<Output> {
  private terminal = false;
  private abortRequested = false;
  private localFailure?: AccountCatalogError;
  private output?: { value: Output };
  private timer: ReturnType<typeof setTimeout>;
  readonly outcome: Promise<Output>;
  private resolve!: (value: Output) => void;
  private reject!: (error: AccountCatalogError) => void;

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
      this.complete(this.localFailure ?? asTransactionError(transaction.error));
    transaction.onerror = () => this.abort();
    if (signal)
      EventTarget.prototype.addEventListener.call(signal, 'abort', this.abort, { once: true });
  }

  private complete(result: { value: Output } | AccountCatalogError): void {
    if (this.terminal) return;
    this.terminal = true;
    clearTimeout(this.timer);
    if (this.signal)
      EventTarget.prototype.removeEventListener.call(this.signal, 'abort', this.abort);
    if (result instanceof AccountCatalogError) this.reject(result);
    else this.resolve(result.value);
  }

  private readonly unknown = (): void => {
    if (this.terminal) return;
    this.complete(new AccountCatalogError('transaction-outcome-unknown'));
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
      // Commit may have won the race; still wait for the terminal event.
    }
  };

  private request<Value>(request: IDBRequest<Value>, onSuccess: (value: Value) => void): void {
    request.onerror = () => {
      if (!this.abortRequested) this.localFailure = asTransactionError(request.error);
      this.abort();
    };
    request.onsuccess = () => {
      if (this.terminal) return;
      try {
        onSuccess(request.result);
      } catch (error) {
        if (!this.abortRequested) this.localFailure = asTransactionError(error);
        this.abort();
      }
    };
  }

  run(mode: IDBTransactionMode, action: (context: CatalogTransaction<Output>) => void): void {
    try {
      if (mode === 'readwrite' && this.transaction.durability !== 'strict')
        throw new AccountCatalogError('unsupported');
      if (isAborted(this.signal)) return this.abort();
      action({
        slots: this.transaction.objectStore(SLOTS),
        owners: this.transaction.objectStore(OWNERS),
        request: (request, onSuccess) => this.request(request, onSuccess),
        finish: value => {
          this.output = { value };
        },
      });
    } catch (error) {
      this.localFailure = asTransactionError(error);
      this.abort();
    }
  }
}

export class CatalogConnection {
  private reason?: AccountCatalogErrorCode;
  private readonly pending = new Map<Promise<unknown>, () => void>();

  constructor(
    private readonly database: IDBDatabase,
    private readonly timeoutMs: number
  ) {
    database.onversionchange = () => this.stop('version-changed');
    database.onclose = () => this.stop('closed');
  }

  private stop(reason: AccountCatalogErrorCode): void {
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
    action: (context: CatalogTransaction<Output>) => void,
    signal?: AbortSignal
  ): Promise<Output> {
    if (this.reason) throw new AccountCatalogError(this.reason);
    if (isAborted(signal)) throw new AccountCatalogError('transaction-aborted');
    let transaction: IDBTransaction;
    try {
      transaction =
        mode === 'readwrite'
          ? this.database.transaction([...STORES], mode, { durability: 'strict' })
          : this.database.transaction([...STORES], mode);
    } catch (error) {
      if (mode === 'readwrite' && error instanceof TypeError)
        throw new AccountCatalogError('unsupported');
      throw asTransactionError(error);
    }
    const session = new TransactionSession<Output>(
      transaction,
      this.timeoutMs,
      () => this.stop('transaction-outcome-unknown'),
      signal
    );
    this.pending.set(session.outcome, session.abort);
    session.run(mode, action);
    try {
      return await session.outcome;
    } finally {
      this.pending.delete(session.outcome);
    }
  }
}
