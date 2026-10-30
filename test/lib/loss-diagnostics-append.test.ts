import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAppendContent } from '../../src/lib/append-utils';
import { applyLineEnding, parseFrontmatter } from '../../src/lib/frontmatter-parser';
import { handleSave } from '../../src/background/obsidian-handlers';
import { DEFAULT_SYNC_SETTINGS } from '../../src/lib/settings-schema';
import {
  MESSAGE_BOUNDARY_FORMAT_MARKER,
  MESSAGE_BOUNDARY_MARKER,
} from '../../src/lib/message-counter';
import type { ExtensionSettings, LiskaLossDiagnosticCode, ObsidianNote } from '../../src/lib/types';

const client = vi.hoisted(() => ({
  getFile: vi.fn(),
  putFile: vi.fn(),
  putBinaryFile: vi.fn(),
  listEntries: vi.fn(),
}));
vi.mock('../../src/lib/obsidian-api', () => ({
  ObsidianApiClient: class {
    getFile = client.getFile;
    putFile = client.putFile;
    putBinaryFile = client.putBinaryFile;
    listEntries = client.listEntries;
  },
  isObsidianApiError: () => false,
}));

const settings: ExtensionSettings = {
  ...DEFAULT_SYNC_SETTINGS,
  obsidianApiKey: 'test-key',
  vaultPath: 'AI',
  enableAppendMode: true,
};

function body(count = 2): string {
  return [
    MESSAGE_BOUNDARY_FORMAT_MARKER,
    ...Array.from({ length: count }, (_, index) => `${MESSAGE_BOUNDARY_MARKER}\nMessage ${index}`),
  ].join('\n\n');
}

function incoming(codes?: LiskaLossDiagnosticCode[], count = 2): ObsidianNote {
  return {
    fileName: 'conversation-loss-example.md',
    contentHash: 'content-hash',
    body: body(count),
    frontmatter: {
      id: 'loss-example',
      title: 'Loss example',
      source: 'gemini',
      url: 'https://gemini.google.com/app/loss-example',
      created: '2026-01-01',
      modified: '2026-01-01',
      tags: ['mine'],
      message_count: count,
      ...(codes !== undefined && { liska_loss_diagnostics: codes }),
    },
  };
}

function existing(extra = '', existingBody = body(), count = 2): string {
  return [
    '---',
    'id: loss-example',
    'title: "Keep my title"',
    '# Keep my comment',
    'modified: "2026-01-01"',
    `message_count: ${count}`,
    ...(extra ? extra.split('\n') : []),
    'tags:',
    '  - mine',
    '---',
    '',
    existingBody,
  ].join('\n');
}

beforeEach(() => {
  vi.resetAllMocks();
  client.getFile.mockResolvedValue(null);
  client.putFile.mockResolvedValue(undefined);
  client.putBinaryFile.mockResolvedValue(undefined);
  client.listEntries.mockResolvedValue([]);
});

describe('historical loss evidence during append', () => {
  it('durably adds the Claude omission code once while retaining every older diagnostic', () => {
    const onDisk = existing(
      'liska_loss_diagnostics_schema: 1\nliska_loss_diagnostics:\n  - history-load-partial\n  - image-capture-failed'
    );
    const note = incoming(['claude-artifact-content-omitted']);
    note.frontmatter.source = 'claude';
    note.frontmatter.url = 'https://claude.ai/chat/synthetic';
    const result = buildAppendContent(onDisk, note, settings);

    expect(result).toMatchObject({ messagesAppended: 0, diagnosticsOnly: true });
    expect(result?.updatedFrontmatter).toContain(
      'liska_loss_diagnostics:\n  - claude-artifact-content-omitted\n  - history-load-partial\n  - image-capture-failed'
    );
    expect(parseFrontmatter(result!.content)?.body).toBe(parseFrontmatter(onDisk)?.body);
    expect(buildAppendContent(result!.content, note, settings)).toBeNull();
  });

  it('adds only owned frontmatter fields on an equal-count update', () => {
    const onDisk = existing('', body() + '\n\nUser-owned footer <custom> stays.\n');
    const result = buildAppendContent(onDisk, incoming(['image-capture-failed']), settings);
    expect(result).toMatchObject({ messagesAppended: 0, diagnosticsOnly: true, newMessages: '' });
    expect(parseFrontmatter(result!.content)?.body).toBe(parseFrontmatter(onDisk)?.body);
    expect(result!.updatedFrontmatter).toContain('modified: "2026-01-01"');
    expect(result!.updatedFrontmatter).toContain('# Keep my comment');
    expect(result!.updatedFrontmatter).toContain('liska_loss_diagnostics_schema: 1');
    expect(result!.updatedFrontmatter).toContain('  - image-capture-failed');
    expect(
      buildAppendContent(result!.content, incoming(['image-capture-failed']), settings)
    ).toBeNull();
  });

  it('unions historical codes with new messages and never clears older observations', () => {
    const onDisk = existing(
      'liska_loss_diagnostics_schema: 1\nliska_loss_diagnostics:\n  - image-capture-failed'
    );
    const result = buildAppendContent(onDisk, incoming(['history-load-partial'], 4), settings);
    expect(result?.messagesAppended).toBe(2);
    expect(result?.newMessages).toBe(
      `${MESSAGE_BOUNDARY_MARKER}\nMessage 2\n\n${MESSAGE_BOUNDARY_MARKER}\nMessage 3`
    );
    expect(result?.updatedFrontmatter).toContain(
      'liska_loss_diagnostics:\n  - history-load-partial\n  - image-capture-failed'
    );
    expect(buildAppendContent(result!.content, incoming(undefined, 4), settings)).toBeNull();
  });

  it('does not attach evidence from shorter captures', () => {
    const result = buildAppendContent(
      existing('', body(4), 4),
      incoming(['image-capture-failed']),
      settings
    );
    expect(result).toBeNull();
  });

  it('does not write an equal-count note with no new diagnostics', () => {
    expect(buildAppendContent(existing(), incoming(), settings)).toBeNull();
  });

  it('requires fresh trusted message boundaries even on a diagnostic-only update', () => {
    const note = incoming(['image-capture-failed']);
    note.body = 'Untrusted incoming body';
    expect(() => buildAppendContent(existing(), note, settings)).toThrow(
      'append-message-boundaries-untrusted'
    );
  });

  it('requires matching identity on the pure diagnostic-only path', () => {
    const note = incoming(['image-capture-failed']);
    note.frontmatter.id = 'different-conversation';
    expect(() => buildAppendContent(existing(), note, settings)).toThrow(
      'append-message-boundaries-untrusted'
    );
  });

  it('preserves a non-delimiter line that merely starts with three dashes', () => {
    const onDisk = existing('---custom: keep-me');
    const result = buildAppendContent(onDisk, incoming(['image-capture-failed']), settings);

    expect(result?.diagnosticsOnly).toBe(true);
    expect(result?.updatedFrontmatter).toContain('---custom: keep-me');
    expect(parseFrontmatter(result!.content)?.body).toBe(parseFrontmatter(onDisk)?.body);
  });

  it('refuses an unknown historical block instead of silently replacing it', () => {
    const onDisk = existing(
      'liska_loss_diagnostics_schema: 2\nliska_loss_diagnostics:\n  - future-evidence'
    );
    expect(() =>
      buildAppendContent(onDisk, incoming(['image-capture-failed'], 4), settings)
    ).toThrow('liska-loss-diagnostics-untrusted');
  });

  it('refuses explicit YAML owned keys instead of inserting a second block', () => {
    const onDisk = existing(
      '? liska_loss_diagnostics_schema\n: 99\n? liska_loss_diagnostics\n: [future-evidence]'
    );
    expect(() =>
      buildAppendContent(onDisk, incoming(['image-capture-failed'], 4), settings)
    ).toThrow('liska-loss-diagnostics-untrusted');
  });

  it('refuses tagged owned keys instead of inserting a second block', () => {
    const onDisk = existing(
      '!!str liska_loss_diagnostics_schema: 99\n!!str liska_loss_diagnostics: [future-evidence]'
    );
    expect(() =>
      buildAppendContent(onDisk, incoming(['image-capture-failed'], 4), settings)
    ).toThrow('liska-loss-diagnostics-untrusted');
  });

  it('refuses double-quoted line-continuation owned keys', () => {
    const onDisk = existing(
      '? "liska_loss_diag\\\n  nostics_schema"\n: 99\n? "liska_loss_diag\\\n  nostics"\n: [future-evidence]'
    );
    expect(() =>
      buildAppendContent(onDisk, incoming(['image-capture-failed'], 4), settings)
    ).toThrow('liska-loss-diagnostics-untrusted');
  });

  it.each(['\n', '\r\n'])('preserves existing body and EOL for metadata-only update (%j)', eol => {
    const onDisk = existing('', body() + '\n\nUser footer.\n').replace(/\n/g, eol);
    const result = buildAppendContent(onDisk, incoming(['history-load-partial']), settings)!;
    expect(result.eol).toBe(eol);
    const written = result.preserveLineEndings
      ? result.content
      : applyLineEnding(result.content, result.eol);
    const separator = `${eol}---${eol}`;
    const splitBody = (value: string) => value.slice(value.indexOf(separator) + separator.length);
    expect(splitBody(written)).toBe(splitBody(onDisk));
    expect(eol === '\r\n' ? !/(?<!\r)\n/.test(written) : !written.includes('\r')).toBe(true);
  });

  it('preserves a mixed-EOL body byte-for-byte during metadata-only delivery', async () => {
    const lfBody = body() + '\n\nUser-owned LF footer.\n';
    const onDisk = existing('', lfBody).replace(/^---\n([\s\S]*?)\n---\n/, match =>
      match.replace(/\n/g, '\r\n')
    );
    const separator = '\r\n---\r\n';
    const originalBody = onDisk.slice(onDisk.indexOf(separator) + separator.length);
    client.getFile.mockResolvedValue(onDisk);

    const result = await handleSave(settings, incoming(['history-load-partial']));

    expect(result).toMatchObject({ success: true, messagesAppended: 0 });
    const written = client.putFile.mock.calls[0]?.[1] as string;
    expect(written.slice(written.indexOf(separator) + separator.length)).toBe(originalBody);
    expect(originalBody).toContain('\n');
    expect(originalBody).not.toContain('\r\n');
  });
});

describe('Obsidian diagnostic-only delivery', () => {
  it('reports metadata-only persistence honestly and leaves body bytes unchanged', async () => {
    const onDisk = existing('', body() + '\n\nUser-owned <custom> body.\n').replace(/\n/g, '\r\n');
    client.getFile.mockResolvedValue(onDisk);
    const result = await handleSave(settings, incoming(['image-capture-failed']));
    expect(result).toEqual({
      success: true,
      isNewFile: false,
      messagesAppended: 0,
      warning: 'Historical capture-loss diagnostics updated; no messages appended',
    });
    expect(client.putFile).toHaveBeenCalledTimes(1);
    const [path, written] = client.putFile.mock.calls[0] as [string, string];
    expect(path).toBe('AI/conversation-loss-example.md');
    expect(written.slice(written.indexOf('\r\n---\r\n') + 7)).toBe(
      onDisk.slice(onDisk.indexOf('\r\n---\r\n') + 7)
    );
    expect(written).toContain('liska_loss_diagnostics_schema: 1');
    expect(written).toContain('modified: "2026-01-01"');

    client.getFile.mockResolvedValue(written);
    client.putFile.mockClear();
    await expect(handleSave(settings, incoming(['image-capture-failed']))).resolves.toEqual({
      success: true,
      isNewFile: false,
      messagesAppended: 0,
    });
    expect(client.putFile).not.toHaveBeenCalled();
  });

  it('translates unknown diagnostic blocks to a fixed terminal failure without a fork', async () => {
    client.getFile.mockResolvedValue(
      existing('liska_loss_diagnostics_schema: 99\nliska_loss_diagnostics:\n  - future-evidence')
    );
    await expect(handleSave(settings, incoming(['history-load-partial'], 4))).resolves.toEqual({
      success: false,
      error: 'liska-loss-diagnostics-untrusted',
    });
    expect(client.putFile).not.toHaveBeenCalled();
    expect(client.listEntries).not.toHaveBeenCalled();
  });

  it('does not write rejected partial or shorter observations', async () => {
    client.getFile.mockResolvedValue(existing('', body(4), 4));
    await expect(handleSave(settings, incoming(['image-capture-failed']))).resolves.toMatchObject({
      success: true,
      messagesAppended: 0,
    });
    expect(client.putFile).not.toHaveBeenCalled();
  });
});
