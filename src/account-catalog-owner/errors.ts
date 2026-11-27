export type AccountCatalogErrorCode =
  | 'invalid-input'
  | 'invalid-options'
  | 'limit-exceeded'
  | 'capacity'
  | 'unavailable'
  | 'unsupported'
  | 'corrupt'
  | 'open-failed'
  | 'open-blocked'
  | 'open-timeout'
  | 'closed'
  | 'version-changed'
  | 'conflict'
  | 'quota-exceeded'
  | 'transaction-aborted'
  | 'transaction-outcome-unknown';

export class AccountCatalogError extends Error {
  constructor(readonly code: AccountCatalogErrorCode) {
    super(code);
    this.name = 'AccountCatalogError';
  }
}
