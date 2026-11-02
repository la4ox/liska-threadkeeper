/**
 * Explicit dependency for pre-existing action-validation/output unit suites.
 * These tests begin AFTER operation admission, preserving their old payload/sink
 * assertions. Real, unmocked authority is covered in export-operation-*.test.ts.
 */
export class AdmittedExportController {
  async authorize(): Promise<boolean> {
    return true;
  }
  async recordResult(): Promise<void> {}
  async settingsChanged(): Promise<void> {}
  async takeStageForCleanup(): Promise<boolean> {
    return true;
  }
  async dispatchStageCommit<T>(
    _message: unknown,
    _sender: unknown,
    dispatch: () => Promise<T>
  ): Promise<{ dispatched: true; result: Promise<T> }> {
    return { dispatched: true, result: dispatch() };
  }
  isUiCandidate(sender: chrome.runtime.MessageSender): boolean {
    return (
      sender.id === chrome.runtime.id &&
      sender.tab === undefined &&
      sender.url === chrome.runtime.getURL('src/popup/index.html')
    );
  }
  async isUi(sender: chrome.runtime.MessageSender): Promise<boolean> {
    return this.isUiCandidate(sender);
  }
}
