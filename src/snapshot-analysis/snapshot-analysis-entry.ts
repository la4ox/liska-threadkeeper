import { initSnapshotAnalysisPage } from './app';

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => initSnapshotAnalysisPage(), { once: true });
} else {
  initSnapshotAnalysisPage();
}
