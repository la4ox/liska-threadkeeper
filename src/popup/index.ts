/**
 * Popup Entry Point — import-time side effect only.
 *
 * All logic lives in app.ts so tests can import it without import-time DOM
 * lookups; this shim is the only file excluded from coverage.
 */

import { initPopup } from './app';
import { initExportSurface } from './export';

document.addEventListener('DOMContentLoaded', () => {
  void initExportSurface();
  initPopup().catch(error => {
    console.error('[G2O Popup] Init error:', error);
  });
});
