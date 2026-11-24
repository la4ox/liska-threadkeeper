// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import {
  INVENTORY,
  buildClaudeAccountBaselineOwnerBrowser,
  inspectHarnessBuild,
} from '../../scripts/build-claude-account-baseline-owner-browser.mjs';
import { openClaudeAccountBaselineOwner } from '../../src/claude-account-baseline-owner';
import { admitted, collectionA } from '../browser/claude-account-baseline-owner/fixture';
import {
  runClaudeAccountOwnerScenario,
  steps,
} from '../browser/claude-account-baseline-owner/scenario';

describe('independent Claude account owner acceptance extension', () => {
  it('packages the exact source closure in a deterministic zero-permission extension', async () => {
    const output = mkdtempSync(join(tmpdir(), 'liska-claude-owner-check-'));
    try {
      const built = await buildClaudeAccountBaselineOwnerBrowser(output);
      expect(built.ok).toBe(true);
      expect(built.files.map((file: { id: string }) => file.id)).toEqual(INVENTORY);
      expect(inspectHarnessBuild(output)).toEqual(built);
      expect(await buildClaudeAccountBaselineOwnerBrowser(output)).toEqual(built);
      const manifest = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8'));
      expect(manifest.permissions).toEqual([]);
      expect(manifest.host_permissions).toEqual([]);
      expect(manifest.content_security_policy.extension_pages).toContain("connect-src 'none'");
      expect(manifest.background).toBeUndefined();
      expect(manifest.content_scripts).toBeUndefined();
    } finally {
      rmSync(output, { recursive: true });
    }
  });

  it('passes every observable scenario and cleans up precisely its own database', async () => {
    const factory = new IDBFactory();
    const before = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open('unrelated-synthetic-domain');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    before.close();
    const originalAdd = IDBObjectStore.prototype.add;
    const result = await runClaudeAccountOwnerScenario(factory, IDBObjectStore.prototype);
    expect(result).toEqual({ ok: true, passed: steps });
    expect(IDBObjectStore.prototype.add).toBe(originalAdd);
    expect(await factory.databases()).toEqual([{ name: 'unrelated-synthetic-domain', version: 1 }]);
  });

  it('refuses a pre-existing target domain without deleting, replacing or reporting its data', async () => {
    const factory = new IDBFactory();
    const existing = await openClaudeAccountBaselineOwner({ indexedDB: factory });
    const result = await existing.createPaused(collectionA, admitted(12));
    expect(await runClaudeAccountOwnerScenario(factory, IDBObjectStore.prototype)).toEqual({
      ok: false,
      failed: 'preflight',
      passed: [],
    });
    expect(await existing.read()).toEqual(result.baseline);
    await existing.close();
  });
});
