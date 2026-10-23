import { describe, expect, it, vi } from 'vitest';
import {
  decorateChatGptArchiveNote,
  decorateChatGptArchivePresentation,
} from '../../src/content/chatgpt-archive-links';
import type { ChatGptDestinationArchiveReceipt } from '../../src/lib/chatgpt-archive-receipt';
import { generateHash } from '../../src/lib/hash';
import type { ObsidianNote } from '../../src/lib/types';

function note(): ObsidianNote {
  return {
    fileName: 'test.md',
    body: 'Existing text [provider link](sandbox:/mnt/data/private-name.pdf)',
    contentHash: 'stale-hash',
    frontmatter: {
      id: 'chatgpt_safe',
      title: 'Provider private title',
      source: 'chatgpt',
      url: 'https://chatgpt.com/c/safe',
      created: '2026-01-01T00:00:00.000Z',
      modified: '2026-01-01T00:00:00.000Z',
      tags: ['ai'],
      message_count: 1,
    },
    images: [{ id: 'img-1', mimeType: 'image/png', data: 'AA==', alt: 'existing image' }],
  };
}

function receipt(): ChatGptDestinationArchiveReceipt {
  return {
    destination: 'obsidian',
    captureId: 'capture-chatgpt-01234567-89ab-4cde-8f01-23456789abcd',
    conversationKey: 'c'.repeat(64),
    manifestSha256: 'd'.repeat(64),
    assets: [],
  };
}

function pdf(sha256: string) {
  return {
    sha256,
    relativePath: `assets/${sha256}.pdf`,
    mediaType: 'application/pdf',
    byteLength: 123,
  };
}

describe('decorateChatGptArchiveNote', () => {
  it('adds provenance only for zero assets and clones the note without changing the source', () => {
    const original = note();
    const before = structuredClone(original);
    const decorated = decorateChatGptArchiveNote(original, receipt());

    expect(original).toEqual(before);
    expect(decorated).not.toBe(original);
    expect(decorated.frontmatter).not.toBe(original.frontmatter);
    expect(decorated.frontmatter.tags).not.toBe(original.frontmatter.tags);
    expect(decorated.images).not.toBe(original.images);
    expect(decorated.images?.[0]).not.toBe(original.images?.[0]);
    expect(decorated.frontmatter).toEqual({
      ...original.frontmatter,
      archive_capture_id: receipt().captureId,
      archive_manifest_sha256: receipt().manifestSha256,
    });
    expect(decorated.body).toBe(original.body);
    expect(decorated.fileName).toBe('test--capture-01234567-89ab-4cde-8f01-23456789abcd.md');
    expect(decorated.body).not.toContain('## Local archive attachments');
    expect(decorated.contentHash).toBe(generateHash(decorated.body));
  });

  it('renders distinct same-extension assets with generic sorted labels and collision-free targets', () => {
    const original = note();
    const input = { ...receipt(), assets: [pdf('b'.repeat(64)), pdf('a'.repeat(64))] };
    const decorated = decorateChatGptArchiveNote(original, input);
    const root = `_liska-archive/${input.conversationKey}/${input.captureId}`;
    const section = [
      '## Local archive attachments',
      '',
      `- [Attachment 1 (pdf)](${root}/assets/${'a'.repeat(64)}.pdf)`,
      `- [Attachment 2 (pdf)](${root}/assets/${'b'.repeat(64)}.pdf)`,
    ].join('\n');

    expect(decorated.body).toBe(`${original.body}\n\n${section}`);
    expect(section).not.toContain(original.frontmatter.title);
    expect(section).not.toContain('private-name');
    expect(decorated.fileName).toBe('test--capture-01234567-89ab-4cde-8f01-23456789abcd.md');
    expect(decorated.contentHash).toBe(generateHash(decorated.body));
    expect(decorated.contentHash).not.toBe(original.contentHash);
    expect(
      decorateChatGptArchiveNote(original, { ...input, assets: [...input.assets].reverse() })
    ).toEqual(decorated);
    expect(decorateChatGptArchiveNote(original, { ...input, destination: 'file' })).toEqual(
      decorated
    );
  });

  it('leaves existing sandbox links untouched and keeps archive targets independent of the base filename', () => {
    const original = note();
    const input = { ...receipt(), assets: [pdf('a'.repeat(64))] };
    const decorated = decorateChatGptArchiveNote(original, input);
    const renamed = decorateChatGptArchiveNote(
      { ...original, fileName: 'collision-safe-name.md' },
      input
    );

    expect(decorated.body.startsWith(original.body)).toBe(true);
    expect(renamed.body).toBe(decorated.body);
    expect(renamed.contentHash).toBe(decorated.contentHash);
    expect(renamed.fileName).toBe(
      'collision-safe-name--capture-01234567-89ab-4cde-8f01-23456789abcd.md'
    );
  });

  it('does not introduce leading blank lines or an absent images field for an empty note', () => {
    const original = note();
    delete original.images;
    original.body = '';
    const decorated = decorateChatGptArchiveNote(original, {
      ...receipt(),
      assets: [pdf('a'.repeat(64))],
    });

    expect(decorated.body.startsWith('## Local archive attachments\n\n')).toBe(true);
    expect(decorated).not.toHaveProperty('images');
  });

  it.each([
    null,
    { ...receipt(), destination: 'clipboard' },
    { ...receipt(), manifestSha256: 'invalid' },
    { ...receipt(), assets: [pdf('a'.repeat(64)), pdf('a'.repeat(64))] },
    { ...receipt(), assets: [{ ...pdf('a'.repeat(64)), status: 'failed' }] },
    { ...receipt(), assets: [{ ...pdf('a'.repeat(64)), status: 'not-attempted' }] },
    { ...receipt(), assets: [{ ...pdf('a'.repeat(64)), relativePath: '../private.pdf' }] },
    { ...receipt(), providerTitle: 'private' },
  ])('rejects malformed receipts before decorating %j', input => {
    const original = note();
    const before = structuredClone(original);
    expect(() => decorateChatGptArchiveNote(original, input)).toThrow(TypeError);
    expect(original).toEqual(before);
  });

  it('rejects accessors without reading them or changing the note', () => {
    const getter = vi.fn(() => []);
    const input = Object.defineProperty(receipt(), 'assets', { get: getter });
    expect(() => decorateChatGptArchiveNote(note(), input)).toThrow(TypeError);
    expect(getter).not.toHaveBeenCalled();
  });
});

describe('decorateChatGptArchivePresentation', () => {
  function presentation(): ObsidianNote {
    const original = note();
    return {
      ...original,
      fileName: 'thread-safe--branch-002--01234567-89ab-4cde-8f01-23456789abcd.md',
      frontmatter: {
        ...original.frontmatter,
        presentation_mode: 'all-branches-leaf',
        archive_capture_id: receipt().captureId,
      },
    };
  }

  it.each(['all-branches-leaf', 'all-branches-index'] as const)(
    'preserves the prepared %s filename and detaches provenance and image fields',
    mode => {
      const original = presentation();
      original.frontmatter.presentation_mode = mode;
      const before = structuredClone(original);
      const evidence = { ...receipt(), assets: [pdf('a'.repeat(64))] };
      const decorated = decorateChatGptArchivePresentation(original, evidence);
      evidence.assets[0].relativePath = 'mutated';
      evidence.manifestSha256 = 'e'.repeat(64);
      expect(original).toEqual(before);
      expect(decorated.fileName).toBe(original.fileName);
      expect(decorated.frontmatter.archive_manifest_sha256).toBe(receipt().manifestSha256);
      expect(decorated.body).toContain(original.body);
      expect(decorated.body).toContain(`/assets/${'a'.repeat(64)}.pdf)`);
      expect(decorated.body).not.toContain('mutated');
      expect(decorated.contentHash).toBe(generateHash(decorated.body));
      expect(decorated.frontmatter.tags).not.toBe(original.frontmatter.tags);
      expect(decorated.images?.[0]).not.toBe(original.images?.[0]);
    }
  );

  it('binds an empty-assets receipt without adding an appendix or another capture suffix', () => {
    const original = presentation();
    const decorated = decorateChatGptArchivePresentation(original, receipt());
    expect(decorated.body).toBe(original.body);
    expect(decorated.frontmatter.archive_manifest_sha256).toBe(receipt().manifestSha256);
    expect(decorated.fileName).toBe(original.fileName);
    expect(decorated.fileName).not.toContain('--capture-');
  });

  it.each(['missing-mode', 'missing-capture', 'wrong-capture', 'wrong-mode', 'malformed-receipt'])(
    'rejects %s before decoration',
    mutation => {
      const original = presentation();
      if (mutation === 'missing-mode') delete original.frontmatter.presentation_mode;
      if (mutation === 'missing-capture') delete original.frontmatter.archive_capture_id;
      if (mutation === 'wrong-capture') original.frontmatter.archive_capture_id += '-other';
      if (mutation === 'wrong-mode') original.frontmatter.presentation_mode = undefined;
      const before = structuredClone(original);
      expect(() =>
        decorateChatGptArchivePresentation(
          original,
          mutation === 'malformed-receipt' ? { ...receipt(), assets: null } : receipt()
        )
      ).toThrow(TypeError);
      expect(original).toEqual(before);
    }
  );
});
