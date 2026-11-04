/** Page-owned limits are independent of analysis and capture/export limits. */
export const CATALOG_PAGE_LIMITS = Object.freeze({
  maxFiles: 4_096,
  maxManifests: 128,
  maxManifestBytes: 256 * 1024,
  maxTotalManifestBytes: 8 * 1024 * 1024,
  maxFileBytes: 1024 ** 4,
  maxTotalBytes: 8 * 1024 ** 4,
  maxPathLength: 512,
  maxReportBytes: 1024 * 1024,
});
