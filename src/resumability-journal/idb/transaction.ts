import { JOURNAL_STORE_NAME, type DatabaseDependencies, type JournalConnection } from './database';
import { JournalStorageError, nativeErrorCode, transactionError } from './errors';

export interface JournalTransaction<Output> {
  store: IDBObjectStore;
  request<Value>(request: IDBRequest<Value>, onSuccess: (value: Value) => void): void;
  finish(value: Output): void;
}

export type JournalTransactionRunner = <Output>(
  mode: IDBTransactionMode,
  action: (context: JournalTransaction<Output>) => void
) => Promise<Output>;

/** Owns one transaction's completion, failure, timeout and connection fence. */
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
    private readonly connection: JournalConnection,
    private readonly dependencies: DatabaseDependencies,
    private readonly resolve: (value: Output) => void,
    private readonly reject: (error: Error) => void
  ) {
    this.timer = dependencies.timers.setTimeout(
      () => this.fail(new JournalStorageError('transaction-timeout')),
      dependencies.transactionTimeoutMs
    );
    connection.transactions.set(transaction, this.fail);
    // A late abort request is not evidence of rollback; the terminal event decides.
    transaction.oncomplete = () => this.complete();
    transaction.onabort = () =>
      this.complete(
        this.failure ??
          new JournalStorageError(nativeErrorCode(transaction.error, 'transaction-aborted'))
      );
    transaction.onerror = () => {
      this.failure ??= this.nativeFailure(transaction.error);
    };
  }

  private nativeFailure(error: unknown): JournalStorageError {
    return new JournalStorageError(
      nativeErrorCode(error, this.transaction.mode === 'readonly' ? 'read-failed' : 'write-failed')
    );
  }

  private complete(error?: Error): void {
    if (this.settled) return;
    this.settled = true;
    this.dependencies.timers.clearTimeout(this.timer);
    if (this.terminalWaitStarted) this.dependencies.timers.clearTimeout(this.terminalTimer);
    // Removing an in-memory transaction handle never removes a stored journal.
    const connection = this.connection;
    connection.transactions.delete(this.transaction);
    if (error) this.reject(error);
    else if (this.hasOutput) this.resolve(this.output);
    else this.reject(new JournalStorageError('transaction-outcome-unknown'));
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
      // Committing/finished transactions reject abort but may still complete successfully.
      // Keep waiting; the secondary deadline can report uncertainty, never rollback.
    }
  };

  private waitForTerminal(): void {
    if (this.terminalWaitStarted) return;
    this.terminalWaitStarted = true;
    this.dependencies.timers.clearTimeout(this.timer);
    this.terminalTimer = this.dependencies.timers.setTimeout(
      () => this.complete(new JournalStorageError('transaction-outcome-unknown')),
      this.dependencies.transactionTimeoutMs
    );
  }

  private request<Value>(request: IDBRequest<Value>, onSuccess: (value: Value) => void): void {
    request.onerror = event => {
      // We perform the abort ourselves and retain the fixed failure code.
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

  context(): JournalTransaction<Output> {
    return {
      store: this.transaction.objectStore(JOURNAL_STORE_NAME),
      request: (request, onSuccess) => this.request(request, onSuccess),
      finish: value => {
        this.output = value;
        this.hasOutput = true;
      },
    };
  }
}

/** All callbacks are synchronous; successful output is released only after commit. */
export function journalTransaction<Output>(
  connection: JournalConnection,
  dependencies: DatabaseDependencies,
  mode: IDBTransactionMode,
  action: (context: JournalTransaction<Output>) => void
): Promise<Output> {
  if (connection.failure) return Promise.reject(connection.failure);
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = connection.database.transaction(JOURNAL_STORE_NAME, mode);
    } catch (error) {
      return reject(new JournalStorageError(nativeErrorCode(error, 'transaction-aborted')));
    }
    const session = new TransactionSession(transaction, connection, dependencies, resolve, reject);
    try {
      action(session.context());
    } catch (error) {
      session.fail(transactionError(error, mode));
    }
  });
}
