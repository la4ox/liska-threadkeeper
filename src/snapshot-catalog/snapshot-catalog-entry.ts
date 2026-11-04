import { initSnapshotCatalogPage } from './app';

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => initSnapshotCatalogPage(), { once: true });
} else {
  initSnapshotCatalogPage();
}
