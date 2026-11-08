import {
  PROVIDER_OPERATIONS_STORE_NAME,
  PROVIDER_OWNER_STORE_NAME,
  type DatabaseDependencies,
  type ProviderOwnerConnection,
} from './database';
import { ProviderOwnerStorageError, nativeErrorCode, transactionError } from './errors';

export interface ProviderOwnerTransaction<Output> {
  owner: IDBObjectStore;
  operations: IDBObjectStore;
  request<Value>(request: IDBRequest<Value>, onSuccess: (value: Value) => void): void;
  finish(value: Output): void;
}

export type ProviderOwnerTransactionRunner = <Output>(
  mode: IDBTransactionMode,
  action: (context: ProviderOwnerTransaction<Output>) => void
) => Promise<Output>;

/** Owns one transaction until the native complete/abort event settles its observable outcome. */
class TransactionSession<Output> {
  private settled = false;
  private hasOutput = false;
  private output!: Output;
  private failure?: Error;
  private abortAccepted = false;
  private terminalWaitStarted = false;
  private readonly timer: unknown;
  private terminalTimer?: unknown;

  constructor(
    private readonly transaction: IDBTransaction,
    private readonly connection: ProviderOwnerConnection,
    private readonly dependencies: DatabaseDependencies,
    private readonly resolve: (value: Output) => void,
    private readonly reject: (error: Error) => void
  ) {
    this.timer = dependencies.timers.setTimeout(
      () => this.fail(new ProviderOwnerStorageError('transaction-timeout')),
      dependencies.transactionTimeoutMs
    );
    connection.transactions.set(transaction, this.fail);
    transaction.oncomplete = () => this.complete();
    transaction.onabort = () =>
      this.complete(
        this.failure ??
          new ProviderOwnerStorageError(nativeErrorCode(transaction.error, 'transaction-aborted'))
      );
    transaction.onerror = () => {
      this.failure ??= this.nativeFailure(transaction.error);
    };
  }

  private nativeFailure(error: unknown): ProviderOwnerStorageError {
    return new ProviderOwnerStorageError(
      nativeErrorCode(error, this.transaction.mode === 'readonly' ? 'read-failed' : 'write-failed')
    );
  }

  private complete(error?: Error): void {
    if (this.settled) return;
    this.settled = true;
    this.dependencies.timers.clearTimeout(this.timer);
    if (this.terminalWaitStarted) this.dependencies.timers.clearTimeout(this.terminalTimer);
    this.connection.transactions.delete(this.transaction);
    if (
      error instanceof ProviderOwnerStorageError &&
      error.code === 'transaction-outcome-unknown'
    ) {
      this.connection.mutationUnknown = true;
      this.connection.invalidate?.();
    }
    if (error) this.reject(error);
    else if (this.hasOutput) this.resolve(this.output);
    else {
      this.connection.mutationUnknown = true;
      this.connection.invalidate?.();
      this.reject(new ProviderOwnerStorageError('transaction-outcome-unknown'));
    }
  }

  readonly fail = (error: Error): void => {
    if (this.settled) return;
    this.failure ??= error;
    this.waitForTerminal();
    if (this.abortAccepted) return;
    try {
      this.transaction.abort();
      this.abortAccepted = true;
    } catch {
      // A transaction may already be committing. Only its terminal event can distinguish it.
    }
  };

  private waitForTerminal(): void {
    if (this.terminalWaitStarted) return;
    this.terminalWaitStarted = true;
    this.dependencies.timers.clearTimeout(this.timer);
    this.terminalTimer = this.dependencies.timers.setTimeout(
      () => this.complete(new ProviderOwnerStorageError('transaction-outcome-unknown')),
      this.dependencies.transactionTimeoutMs
    );
  }

  private request<Value>(request: IDBRequest<Value>, onSuccess: (value: Value) => void): void {
    request.onerror = event => {
      event.preventDefault();
      this.fail(this.nativeFailure(request.error));
    };
    request.onsuccess = () => {
      if (this.abortAccepted || this.settled) return;
      try {
        onSuccess(request.result);
      } catch (error) {
        this.fail(transactionError(error, this.transaction.mode));
      }
    };
  }

  context(): ProviderOwnerTransaction<Output> {
    return {
      owner: this.transaction.objectStore(PROVIDER_OWNER_STORE_NAME),
      operations: this.transaction.objectStore(PROVIDER_OPERATIONS_STORE_NAME),
      request: (request, onSuccess) => this.request(request, onSuccess),
      finish: value => {
        this.output = value;
        this.hasOutput = true;
      },
    };
  }
}

/** All request callbacks stay synchronous; successful output is released only after commit. */
export function providerOwnerTransaction<Output>(
  connection: ProviderOwnerConnection,
  dependencies: DatabaseDependencies,
  mode: IDBTransactionMode,
  action: (context: ProviderOwnerTransaction<Output>) => void
): Promise<Output> {
  if (connection.failure) return Promise.reject(connection.failure);
  if (mode === 'readwrite' && connection.mutationUnknown)
    return Promise.reject(new ProviderOwnerStorageError('transaction-outcome-unknown'));
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      try {
        transaction = connection.database.transaction(
          [PROVIDER_OWNER_STORE_NAME, PROVIDER_OPERATIONS_STORE_NAME],
          mode,
          { durability: 'strict' }
        );
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        transaction = connection.database.transaction(
          [PROVIDER_OWNER_STORE_NAME, PROVIDER_OPERATIONS_STORE_NAME],
          mode
        );
      }
    } catch (error) {
      return reject(new ProviderOwnerStorageError(nativeErrorCode(error, 'transaction-aborted')));
    }
    const session = new TransactionSession(transaction, connection, dependencies, resolve, reject);
    try {
      action(session.context());
    } catch (error) {
      session.fail(transactionError(error, mode));
    }
  });
}
