import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SYNC_SETTINGS } from '../../src/lib/settings-schema';
import { bytesToBase64 } from '../../src/lib/image-utils';
import { sha256Hex } from '../../src/lib/sha256';
import type { ExtensionSettings, ExtractedImage } from '../../src/lib/types';
import {
  AppendImageError,
  commitVerifiedAppendNote,
  persistAppendImagePlan,
  prepareAppendImagePlan,
  prepareAppendTail,
} from '../../src/background/obsidian-append-images';
import { MESSAGE_BOUNDARY_MARKER } from '../../src/lib/message-counter';

const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const image = (overrides: Partial<ExtractedImage> = {}): ExtractedImage => ({
  id: 'img-1',
  mimeType: 'image/png',
  data: bytesToBase64(bytes),
  alt: 'synthetic',
  ...overrides,
});
const placeholder = (id = 'img-1') => `![synthetic](g2o-image://${id})`;
const tail = (value = placeholder()) => `${MESSAGE_BOUNDARY_MARKER}\n${value}`;

const settings: ExtensionSettings = {
  ...DEFAULT_SYNC_SETTINGS,
  imageVaultPath: 'Images/{YYYY}',
};
const variables = { platform: 'gemini', YYYY: '2026', MM: '10', DD: '29' };

function client() {
  return {
    getServerVersions: vi.fn(async () => ({ self: '5.5.2', obsidian: '1.14.5' })),
    getBinaryFileBounded: vi.fn<() => Promise<Uint8Array | null>>(async () => null),
    putBinaryFileIfAbsent: vi.fn(async () => undefined),
    getFile: vi.fn<() => Promise<string | null>>(async () => null),
    putFile: vi.fn(async () => undefined),
  };
}

async function code(promise: Promise<unknown>): Promise<string | undefined> {
  const error = await promise.catch(value => value);
  return error instanceof AppendImageError
    ? error.code
    : typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : undefined;
}

describe('append tail image planning', () => {
  it('returns an image-free tail byte-for-byte even when image export is disabled', async () => {
    const input = `${MESSAGE_BOUNDARY_MARKER}\n\n\n\n\`\`\`text\nline 1\n\n\nline 2\n\`\`\``;
    await expect(prepareAppendTail(input, [], false)).resolves.toEqual({ body: input });
  });

  it('uses exact-byte full-hash names and deduplicates repeated occurrences', async () => {
    const plan = await prepareAppendImagePlan(
      [MESSAGE_BOUNDARY_MARKER, placeholder(), MESSAGE_BOUNDARY_MARKER, placeholder()].join('\n'),
      [image()]
    );
    const digest = await sha256Hex(bytes);
    expect(plan.occurrenceCount).toBe(2);
    expect(plan.assets).toHaveLength(1);
    expect(plan.assets[0]).toMatchObject({
      fileName: `sha256-${digest}.png`,
      mediaType: 'image/png',
      sha256: digest,
    });
    expect(plan.body.match(/!\[\[sha256-/g)).toHaveLength(2);
    expect(plan.body).not.toMatch(/synthetic|img-1|g2o-image/);
    expect(plan.assets[0]!.fileName).not.toMatch(/synthetic|img-1|g2o-image/);
  });

  it('renders distinct ids with identical bytes through one content-addressed asset', async () => {
    const plan = await prepareAppendImagePlan(
      [MESSAGE_BOUNDARY_MARKER, placeholder('img-1'), placeholder('img-2')].join('\n'),
      [image(), image({ id: 'img-2' })]
    );
    expect(plan.occurrenceCount).toBe(2);
    expect(plan.assets).toHaveLength(1);
    expect(plan.body.match(/!\[\[sha256-/g)).toHaveLength(2);
  });

  it('canonicalizes JPEG MIME aliases before exact-byte asset deduplication', async () => {
    const plan = await prepareAppendImagePlan(
      [MESSAGE_BOUNDARY_MARKER, placeholder('img-1'), placeholder('img-2')].join('\n'),
      [image({ mimeType: 'image/jpg' }), image({ id: 'img-2', mimeType: 'image/jpeg' })]
    );
    expect(plan.assets).toHaveLength(1);
    expect(plan.assets[0]).toMatchObject({ mediaType: 'image/jpeg' });
    expect(plan.assets[0]!.fileName).toMatch(/\.jpg$/);
    expect(plan.body.match(/!\[\[sha256-/g)).toHaveLength(2);
  });

  it('rejects contradictory canonical MIME evidence for identical bytes', async () => {
    expect(
      await code(
        prepareAppendImagePlan(
          [MESSAGE_BOUNDARY_MARKER, placeholder('img-1'), placeholder('img-2')].join('\n'),
          [image(), image({ id: 'img-2', mimeType: 'image/jpeg' })]
        )
      )
    ).toBe('append-image-data-invalid');
  });

  it('ignores protected/inline/neutralized lookalikes and preserves the tail marker', async () => {
    const input = [
      MESSAGE_BOUNDARY_MARKER,
      `\`${placeholder()}\``,
      `prefix ${placeholder()} suffix`,
      '&#33;&#91;synthetic](g2o-image://img-1)',
    ].join('\n');
    const plan = await prepareAppendImagePlan(input, [image()]);
    expect(plan.assets).toEqual([]);
    expect(plan.occurrenceCount).toBe(0);
    expect(plan.body.split(MESSAGE_BOUNDARY_MARKER)).toHaveLength(2);
  });

  it.each([
    ['missing image', [], 'append-image-reference-invalid'],
    ['duplicate referenced id', [image(), image()], 'append-image-reference-invalid'],
    ['empty id', [image({ id: '' })], 'append-image-reference-invalid'],
    ['invalid id', [image({ id: 'bad/id' })], 'append-image-reference-invalid'],
    ['disallowed MIME', [image({ mimeType: 'image/svg+xml' })], 'append-image-data-invalid'],
    ['bad base64', [image({ data: 'not-base64' })], 'append-image-data-invalid'],
    ['noncanonical base64', [image({ data: 'AB==' })], 'append-image-data-invalid'],
  ] as const)('blocks %s', async (_label, images, expected) => {
    const id = images[0]?.id ?? 'img-1';
    expect(await code(prepareAppendImagePlan(tail(placeholder(id)), images))).toBe(expected);
  });

  it('ignores duplicate unreferenced image ids', async () => {
    const plan = await prepareAppendImagePlan(tail(), [
      image(),
      image({ id: 'unreferenced' }),
      image({ id: 'unreferenced' }),
    ]);
    expect(plan.assets).toHaveLength(1);
  });
});

describe('append image persistence', () => {
  let plan: Awaited<ReturnType<typeof prepareAppendImagePlan>>;

  beforeEach(async () => {
    plan = await prepareAppendImagePlan(tail(), [image()]);
  });

  it('reuses an exact existing asset without a write', async () => {
    const api = client();
    api.getBinaryFileBounded.mockResolvedValue(bytes);
    await expect(persistAppendImagePlan(api, settings, variables, plan)).resolves.toEqual({
      created: 0,
      reused: 1,
    });
    expect(api.putBinaryFileIfAbsent).not.toHaveBeenCalled();
    expect(api.getBinaryFileBounded).toHaveBeenCalledWith(
      expect.stringMatching(/^Images\/2026\/liska-v1\/sha256-[a-f0-9]{64}\.png$/),
      10 * 1024 * 1024
    );
  });

  it('refuses an occupied different-byte path', async () => {
    const api = client();
    api.getBinaryFileBounded.mockResolvedValue(new Uint8Array([9]));
    expect(await code(persistAppendImagePlan(api, settings, variables, plan))).toBe(
      'append-image-collision'
    );
    expect(api.putBinaryFileIfAbsent).not.toHaveBeenCalled();
  });

  it('creates a missing asset and verifies exact readback', async () => {
    const api = client();
    api.getBinaryFileBounded.mockResolvedValueOnce(null).mockResolvedValueOnce(bytes);
    await expect(persistAppendImagePlan(api, settings, variables, plan)).resolves.toEqual({
      created: 1,
      reused: 0,
    });
    expect(api.putBinaryFileIfAbsent).toHaveBeenCalledOnce();
  });

  it('reconciles a failed/412-like create when exact bytes now exist', async () => {
    const api = client();
    api.getBinaryFileBounded.mockResolvedValueOnce(null).mockResolvedValueOnce(bytes);
    api.putBinaryFileIfAbsent.mockRejectedValue(new Error('private'));
    await expect(persistAppendImagePlan(api, settings, variables, plan)).resolves.toEqual({
      created: 0,
      reused: 1,
    });
  });

  it('blocks an unknown create outcome when readback is missing or different', async () => {
    for (const observed of [null, new Uint8Array([9])]) {
      const api = client();
      api.getBinaryFileBounded.mockResolvedValueOnce(null).mockResolvedValueOnce(observed);
      api.putBinaryFileIfAbsent.mockRejectedValue(new Error('private'));
      expect(await code(persistAppendImagePlan(api, settings, variables, plan))).toBe(
        'append-image-write-unknown'
      );
    }
  });

  it.each(['5.4.9', '5.5.0-beta.1', 'v5.5.0', 'private'])('blocks server %s', async self => {
    const api = client();
    api.getServerVersions.mockResolvedValue({ self, obsidian: '1.14.5' });
    expect(await code(persistAppendImagePlan(api, settings, variables, plan))).toBe(
      'append-image-server-unsupported'
    );
    expect(api.getBinaryFileBounded).not.toHaveBeenCalled();
  });

  it('uses fixed failures for unavailable server info and asset reads', async () => {
    const server = client();
    server.getServerVersions.mockRejectedValue(new Error('private'));
    expect(await code(persistAppendImagePlan(server, settings, variables, plan))).toBe(
      'append-image-server-info-failed'
    );

    const read = client();
    read.getBinaryFileBounded.mockRejectedValue(new Error('private'));
    expect(await code(persistAppendImagePlan(read, settings, variables, plan))).toBe(
      'append-image-read-failed'
    );
  });

  it('blocks failed readback after an accepted create', async () => {
    const api = client();
    api.getBinaryFileBounded
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('private'));
    expect(await code(persistAppendImagePlan(api, settings, variables, plan))).toBe(
      'append-image-readback-failed'
    );
  });

  it('fails a traversal-shaped resolved image path before binary I/O', async () => {
    const api = client();
    expect(
      await code(
        persistAppendImagePlan(api, { ...settings, imageVaultPath: '../private' }, variables, plan)
      )
    ).toBe('append-image-path-invalid');
    expect(api.getBinaryFileBounded).not.toHaveBeenCalled();
  });

  it('does not require server admission for an image-free tail', async () => {
    const api = client();
    const empty = await prepareAppendImagePlan(`${MESSAGE_BOUNDARY_MARKER}\ntext`, []);
    await expect(persistAppendImagePlan(api, settings, variables, empty)).resolves.toEqual({
      created: 0,
      reused: 0,
    });
    expect(api.getServerVersions).not.toHaveBeenCalled();
  });
});

describe('verified append note commit', () => {
  it('requires the exact base and verifies the final note', async () => {
    const api = client();
    api.getFile.mockResolvedValueOnce('base').mockResolvedValueOnce('expected');
    await expect(commitVerifiedAppendNote(api, 'note.md', 'base', 'expected')).resolves.toBe(
      undefined
    );
    expect(api.putFile).toHaveBeenCalledWith('note.md', 'expected');
  });

  it('blocks a changed base before PUT', async () => {
    const api = client();
    api.getFile.mockResolvedValue('changed');
    expect(await code(commitVerifiedAppendNote(api, 'note.md', 'base', 'expected'))).toBe(
      'append-note-changed-before-write'
    );
    expect(api.putFile).not.toHaveBeenCalled();
  });

  it('reconciles a failed PUT only when the expected note is readable', async () => {
    const api = client();
    api.getFile.mockResolvedValueOnce('base').mockResolvedValueOnce('expected');
    api.putFile.mockRejectedValue(new Error('private'));
    await expect(commitVerifiedAppendNote(api, 'note.md', 'base', 'expected')).resolves.toBe(
      undefined
    );
  });

  it('reports an unknown note outcome without retrying', async () => {
    const api = client();
    api.getFile.mockResolvedValueOnce('base').mockResolvedValueOnce('base');
    api.putFile.mockRejectedValue(new Error('private'));
    expect(await code(commitVerifiedAppendNote(api, 'note.md', 'base', 'expected'))).toBe(
      'append-note-write-unknown'
    );
    expect(api.putFile).toHaveBeenCalledOnce();
  });

  it('requires exact readback even when PUT returns success', async () => {
    const api = client();
    api.getFile.mockResolvedValueOnce('base').mockResolvedValueOnce('different');
    expect(await code(commitVerifiedAppendNote(api, 'note.md', 'base', 'expected'))).toBe(
      'append-note-write-unknown'
    );
    expect(api.putFile).toHaveBeenCalledOnce();
  });
});
