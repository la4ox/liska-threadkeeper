import './style.css';
import { installNetworkDenial } from './capabilities';
import { runProviderBaselineOwnerScenario, ROW_IDS, type Receipt } from './scenario';

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
  let denial: ReturnType<typeof installNetworkDenial> | undefined;
  try {
    // Transport denial is installed before the first database request.
    denial = installNetworkDenial(globalThis);
    display(
      await runProviderBaselineOwnerScenario({
        indexedDB,
        crypto,
        timers: {
          setTimeout: (callback, ms) => setTimeout(callback, ms),
          clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
        },
        monotonicNow: () => performance.now(),
        remainedVisible: () => visible,
        networkCalls: denial.calls,
      })
    );
  } catch {
    display({
      schema: 'liska-provider-owner-native-receipt/1',
      status: 'FAIL',
      code: 'acceptance-failed',
      rows: ROW_IDS.map(id => ({ id, status: 'FAIL', metrics: [] })),
      elapsedMs: 0,
      maxGapMs: 0,
    });
  } finally {
    denial?.restore();
    document.removeEventListener('visibilitychange', observe);
  }
});
function display(result: Receipt) {
  overall.textContent = result.status;
  for (const row of result.rows) cells.get(row.id)!.textContent = row.status;
  receipt.textContent = JSON.stringify(result, null, 2);
}
