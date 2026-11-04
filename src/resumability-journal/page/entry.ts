import { createJournalStore } from '../idb';
import { initJournalPage } from './app';

function start() {
  initJournalPage(document, { store: createJournalStore() });
}
if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
