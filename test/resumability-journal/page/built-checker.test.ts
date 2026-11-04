import { describe, expect, it } from 'vitest';
import { inspectJournalJavaScript } from './check-built-page.mjs';
describe('built journal capability guard', () => {
  it('allows only private IndexedDB, exact download observer and localized fixed copy', () => {
    expect(
      inspectJournalJavaScript(
        'indexedDB.open("journal"); chrome.downloads.download({}); chrome.runtime.lastError; chrome.i18n.getMessage("journal_title");'
      )
    ).toEqual([]);
    expect(inspectJournalJavaScript('import {x} from "./pure.js";')).toEqual(['./pure.js']);
  });
  it.each([
    'fetch("https://example.test")',
    'chrome.runtime.sendMessage({})',
    'chrome.tabs.create({})',
    'chrome.alarms.create({})',
    'chrome.storage.local.set({})',
    'navigator.storage.getDirectory()',
    'localStorage.setItem("x", "x")',
    'document.body.innerHTML = "x"',
    'import(variable)',
  ])('rejects %s', source => {
    expect(() => inspectJournalJavaScript(source)).toThrow();
  });
  it('rejects persistence and chrome authority in public shared chunks', () => {
    expect(() => inspectJournalJavaScript('globalThis.indexedDB.open("journal")', true)).toThrow(
      'public-indexeddb-capability'
    );
    expect(() => inspectJournalJavaScript('chrome.downloads.download({})', true)).toThrow(
      'unexpected-built-chrome-capability'
    );
  });
});
