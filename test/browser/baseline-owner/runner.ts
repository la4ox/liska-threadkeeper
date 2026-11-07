import './style.css';
import { installNetworkDenial } from './capabilities';
import { deniedAmbientCalls } from './denied-effects';
import { runBaselineOwnerScenario, ROW_IDS, type Receipt } from './scenario';

const button = document.querySelector<HTMLButtonElement>('#run')!;
const overall = document.querySelector<HTMLOutputElement>('#overall')!;
const receipt = document.querySelector<HTMLPreElement>('#receipt')!;
const body = document.querySelector<HTMLTableSectionElement>('#rows')!;
const cells = new Map<string, HTMLTableCellElement>();
for (const id of ROW_IDS) {
  const row = document.createElement('tr');
  row.id = id;
  const name = document.createElement('th');
  name.textContent = id;
  const status = document.createElement('td');
  status.textContent = 'NOT RUN';
  row.append(name, status);
  body.append(row);
  cells.set(id, status);
}
button.addEventListener('click', async () => {
  button.disabled = true;
  let visible = document.visibilityState === 'visible';
  const observe = () => {
    visible = visible && document.visibilityState === 'visible';
  };
  document.addEventListener('visibilitychange', observe);
  try {
    // Install all transport sentinels before opening IDB or invoking any scenario effects.
    const denial = installNetworkDenial(globalThis);
    const result = await runBaselineOwnerScenario({
      indexedDB,
      crypto,
      timers: {
        setTimeout: (callback, ms) => setTimeout(callback, ms),
        clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
      monotonicNow: () => performance.now(),
      remainedVisible: () => visible,
      networkCalls: denial.calls,
      ambientCalls: deniedAmbientCalls,
    });
    display(result);
  } catch {
    overall.textContent = 'FAIL';
    receipt.textContent = JSON.stringify({ status: 'FAIL', code: 'acceptance-failed' });
    for (const cell of cells.values()) cell.textContent = 'FAIL';
  } finally {
    document.removeEventListener('visibilitychange', observe);
  }
});
function display(result: Receipt) {
  overall.textContent = result.status;
  for (const row of result.rows) cells.get(row.id)!.textContent = row.status;
  receipt.textContent = JSON.stringify(result, null, 2);
}
