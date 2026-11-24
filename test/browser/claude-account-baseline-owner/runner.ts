import { runClaudeAccountOwnerScenario } from './scenario';

const run = document.querySelector<HTMLButtonElement>('#run')!;
const output = document.querySelector<HTMLElement>('#result')!;
run.addEventListener('click', async event => {
  if (!event.isTrusted || run.disabled) return;
  run.disabled = true;
  output.textContent = 'Running…';
  try {
    const result = await runClaudeAccountOwnerScenario(indexedDB, IDBObjectStore.prototype);
    output.textContent = JSON.stringify(result, null, 2);
  } catch {
    output.textContent = '{"ok":false,"failed":"harness"}';
  }
});
