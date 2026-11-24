export type ClaudeAccountBaselineOwnerErrorCode =
  | 'invalid-input'
  | 'invalid-limits'
  | 'limit-exceeded'
  | 'unavailable'
  | 'unsupported'
  | 'corrupt'
  | 'open-failed'
  | 'open-blocked'
  | 'open-timeout'
  | 'closed'
  | 'version-changed'
  | 'conflict'
  | 'transaction-aborted'
  | 'transaction-outcome-unknown';

export class ClaudeAccountBaselineOwnerError extends Error {
  constructor(readonly code: ClaudeAccountBaselineOwnerErrorCode) {
    super(code);
    this.name = 'ClaudeAccountBaselineOwnerError';
  }
}
