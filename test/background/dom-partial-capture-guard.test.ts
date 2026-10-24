import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseExtractor, type ScrollConfig } from '../../src/content/extractors/base';
import { GeminiExtractor } from '../../src/content/extractors/gemini';
import { conversationToNote } from '../../src/content/markdown';
import { validateMessageContent } from '../../src/background/validation';
import { handleSave } from '../../src/background/obsidian-handlers';
import { generateNoteContent } from '../../src/lib/note-generator';
import { collisionSuffix, candidateFileName } from '../../src/lib/filename-collision';
import { DEFAULT_SYNC_SETTINGS } from '../../src/lib/settings-schema';
import {
  MESSAGE_BOUNDARY_FORMAT_MARKER,
  MESSAGE_BOUNDARY_MARKER,
} from '../../src/lib/message-counter';
import { accumulateWhileScrolling, ensureAllElementsLoaded } from '../../src/lib/scroll-manager';
import type { ConversationData, ExtensionSettings, ObsidianNote } from '../../src/lib/types';

vi.mock('../../src/lib/scroll-manager', () => ({
  accumulateWhileScrolling: vi.fn(),
  ensureAllElementsLoaded: vi.fn(),
}));

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
  enableAppendMode: false,
  enableImageExport: true,
};
const messages: ConversationData['messages'] = [
  { id: 'u1', role: 'user', content: 'Question', index: 0 },
  { id: 'a1', role: 'assistant', content: '<p>Answer</p>', index: 1 },
];
const data: ConversationData = {
  id: 'dom-load',
  title: 'DOM load',
  source: 'gemini',
  url: 'https://gemini.google.com/app/abc123',
  messages,
  extractedAt: new Date('2026-01-01T00:00:00Z'),
  metadata: {
    messageCount: 2,
    userMessageCount: 1,
    assistantMessageCount: 1,
    hasCodeBlocks: false,
  },
};

class ScrollingExtractor extends BaseExtractor {
  readonly platform = 'gemini';
  configured = true;
  canExtract() {
    return true;
  }
  getTitle() {
    return data.title;
  }
  getConversationId() {
    return data.id;
  }
  extractMessages() {
    return messages;
  }
  protected getScrollConfig(): ScrollConfig | null {
    return this.configured ? { container: ['#history'], harvest: () => [] } : null;
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  document.body.innerHTML = '<infinite-scroller id="history"></infinite-scroller>';
  client.getFile.mockResolvedValue(null);
  client.putFile.mockResolvedValue(undefined);
  client.putBinaryFile.mockResolvedValue(undefined);
  client.listEntries.mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());

describe('runtime DOM history-load evidence', () => {
  it.each([
    [false, false, 'partial'],
    [true, false, 'complete'],
    [true, true, 'unknown'],
    [false, true, 'unknown'],
  ] as const)(
    'Base fullyLoaded=%s skipped=%s maps to %s',
    async (fullyLoaded, skipped, expected) => {
      vi.mocked(accumulateWhileScrolling).mockResolvedValue({
        fullyLoaded,
        skipped,
        items: messages,
        itemCount: 2,
        scrollIterations: 1,
      });
      const extractor = new ScrollingExtractor();
      extractor.enableAutoScroll = true;
      const result = await extractor.extract();
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('domHistoryLoad', expected);
      expect(!!result.warnings?.some(w => w.includes('Auto-scroll timed out'))).toBe(
        expected === 'partial'
      );
      extractor.enableAutoScroll = false;
      expect((await extractor.extract()).data?.domHistoryLoad).toBe('unknown');
    }
  );

  it.each(['disabled', 'unconfigured', 'missing-container'])('Base %s is unknown', async mode => {
    const extractor = new ScrollingExtractor();
    extractor.enableAutoScroll = mode !== 'disabled';
    extractor.configured = mode !== 'unconfigured';
    if (mode === 'missing-container') document.body.innerHTML = '';
    expect((await extractor.extract()).data).toHaveProperty('domHistoryLoad', 'unknown');
    expect(accumulateWhileScrolling).not.toHaveBeenCalled();
  });

  it.each([
    [false, false, 'partial'],
    [true, false, 'complete'],
    [true, true, 'unknown'],
    [false, true, 'unknown'],
  ] as const)(
    'Gemini fullyLoaded=%s skipped=%s maps to %s',
    async (fullyLoaded, skipped, expected) => {
      vi.mocked(ensureAllElementsLoaded).mockResolvedValue({
        fullyLoaded,
        skipped,
        elementCount: 1,
        scrollIterations: 1,
      });
      const extractor = new GeminiExtractor();
      vi.spyOn(extractor, 'canExtract').mockReturnValue(true);
      vi.spyOn(extractor, 'extractMessages').mockReturnValue(messages);
      extractor.enableAutoScroll = true;
      const result = await extractor.extract();
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('domHistoryLoad', expected);
      expect(!!result.warnings?.some(w => w.includes('Auto-scroll timed out'))).toBe(
        expected === 'partial'
      );
      // A subsequent run cannot inherit the previous loader outcome.
      extractor.enableAutoScroll = false;
      expect((await extractor.extract()).data).toHaveProperty('domHistoryLoad', 'unknown');
    }
  );

  it('Gemini missing container is unknown', async () => {
    document.body.innerHTML = '';
    const extractor = new GeminiExtractor();
    vi.spyOn(extractor, 'canExtract').mockReturnValue(true);
    vi.spyOn(extractor, 'extractMessages').mockReturnValue(messages);
    extractor.enableAutoScroll = true;
    expect((await extractor.extract()).data).toHaveProperty('domHistoryLoad', 'unknown');
    expect(ensureAllElementsLoaded).not.toHaveBeenCalled();
  });

  it.each(['complete', 'partial', 'unknown'] as const)(
    'propagates %s without serializing it',
    domHistoryLoad => {
      const note = conversationToNote(
        { ...data, domHistoryLoad } as ConversationData,
        settings.templateOptions
      );
      expect(note).toHaveProperty('domHistoryLoad', domHistoryLoad);
      expect(note.frontmatter).not.toHaveProperty('domHistoryLoad');
      expect(generateNoteContent(note, settings)).not.toMatch(/domHistoryLoad|dom_history_load/);
      expect(note.frontmatter).not.toHaveProperty('capture_completeness');
    }
  );

  it('does not infer loader evidence from separate archive capture completeness', () => {
    const captured: ConversationData = {
      ...data,
      domHistoryLoad: 'partial',
      capture: { mode: 'structured-api', completeness: 'complete' },
    };
    const note = conversationToNote(captured, settings.templateOptions);
    expect(note.domHistoryLoad).toBe('partial');
    expect(note.frontmatter).toMatchObject({
      capture_mode: 'structured-api',
      capture_completeness: 'complete',
    });
    const serialized = generateNoteContent(note, settings);
    expect(serialized).toContain('capture_completeness: complete');
    expect(serialized).not.toMatch(/domHistoryLoad|dom_history_load/);
    expect(conversationToNote(data, settings.templateOptions)).not.toHaveProperty('domHistoryLoad');
  });

  it.each([null, undefined, '', 'PARTIAL', ' partial', false, 1, {}])(
    'rejects present invalid loader value %s',
    value => {
      const note = { ...incoming(), domHistoryLoad: value };
      expect(
        validateMessageContent({ action: 'saveToOutputs', data: note, outputs: ['obsidian'] })
      ).toBe(false);
    }
  );

  it.each(['complete', 'partial', 'unknown', 'absent'])('accepts %s loader value', value => {
    const note = incoming();
    if (value === 'absent') delete note.domHistoryLoad;
    else note.domHistoryLoad = value as 'partial';
    expect(
      validateMessageContent({ action: 'saveToOutputs', data: note, outputs: ['obsidian'] })
    ).toBe(true);
  });

  it('rejects inherited and accessor loader evidence', () => {
    const inherited = Object.create({ domHistoryLoad: 'partial' }) as ObsidianNote;
    Object.assign(inherited, incoming());
    delete inherited.domHistoryLoad;
    expect(
      validateMessageContent({ action: 'saveToOutputs', data: inherited, outputs: ['obsidian'] })
    ).toBe(false);

    const accessor = incoming();
    const getter = vi.fn(() => 'partial');
    Object.defineProperty(accessor, 'domHistoryLoad', { enumerable: true, get: getter });
    expect(
      validateMessageContent({ action: 'saveToOutputs', data: accessor, outputs: ['obsidian'] })
    ).toBe(false);
  });

  it.each([-1, 0.5, '2', null, undefined, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid incoming count %s',
    count => {
      const note = incoming();
      note.frontmatter.message_count = count as number;
      expect(
        validateMessageContent({ action: 'saveToOutputs', data: note, outputs: ['obsidian'] })
      ).toBe(false);
    }
  );

  it.each([0, 2, Number.MAX_SAFE_INTEGER])(
    'accepts a nonnegative safe incoming count %s',
    count => {
      const note = incoming();
      note.frontmatter.message_count = count;
      expect(
        validateMessageContent({ action: 'saveToOutputs', data: note, outputs: ['obsidian'] })
      ).toBe(true);
    }
  );
});

function incoming(): ObsidianNote {
  const note = conversationToNote(data, settings.templateOptions);
  return {
    ...note,
    domHistoryLoad: 'partial',
    body: note.body + '\n\n![image](g2o-image://img-1)',
    images: [{ id: 'img-1', mimeType: 'image/png', data: 'aGVsbG8=', alt: 'image' }],
  };
}

function existing(count?: string, rendered = 3, v1 = true): string {
  const body = Array.from(
    { length: rendered },
    () => `${v1 ? MESSAGE_BOUNDARY_MARKER + '\n\n' : ''}**User:**\n\nSaved message`
  ).join('\n\n');
  return `---\nid: gemini_dom-load\n${count === undefined ? '' : `message_count: ${count}\n`}---\n${v1 ? MESSAGE_BOUNDARY_FORMAT_MARKER + '\n\n' : ''}${body}`;
}

describe('partial DOM history mutable-note overwrite guard', () => {
  it('allows the first partial save, including images', async () => {
    expect(await handleSave(settings, incoming())).toMatchObject({
      success: true,
      isNewFile: true,
    });
    expect(client.putFile).toHaveBeenCalledTimes(1);
    expect(client.putBinaryFile).toHaveBeenCalledTimes(1);
  });

  it.each(['canonical', 'suffix'])(
    'refuses shorter history at the %s same-ID target without writes or fork',
    async target => {
      const note = incoming();
      client.getFile.mockImplementation(async () => existing());
      if (target === 'suffix') client.getFile.mockResolvedValueOnce('---\nid: foreign\n---\nKeep');
      const result = await handleSave(settings, note);
      expect(result).toEqual({ success: false, error: 'partial-capture-would-shrink-note' });
      expect(client.getFile).toHaveBeenCalledTimes(target === 'canonical' ? 1 : 2);
      expect(client.listEntries).not.toHaveBeenCalled();
      expect(client.putFile).not.toHaveBeenCalled();
      expect(client.putBinaryFile).not.toHaveBeenCalled();
    }
  );

  it.each([
    [undefined, false],
    ['-1', false],
    ['2junk', false],
    ['02', false],
    ['2.0', false],
    ['2e0', false],
    ['9007199254740992', false],
    ['4', false],
    ['2', true],
    ['invalid', true],
  ] as const)('refuses untrusted stored count %s (v1=%s)', async (count, v1) => {
    client.getFile.mockResolvedValue(existing(count, 3, v1));
    expect(await handleSave(settings, incoming())).toEqual({
      success: false,
      error: 'partial-capture-existing-count-untrusted',
    });
    expect(client.putFile).not.toHaveBeenCalled();
    expect(client.putBinaryFile).not.toHaveBeenCalled();
    expect(client.getFile).toHaveBeenCalledTimes(1);
  });

  it('trusts v1 boundaries without stored message_count', async () => {
    client.getFile.mockResolvedValue(existing(undefined));
    expect(await handleSave(settings, incoming())).toMatchObject({
      error: 'partial-capture-would-shrink-note',
    });
  });

  it.each([
    [true, '2', 2],
    [true, '1', 1],
    [false, '2', 3],
    [false, '0', 3],
  ] as const)(
    'allows equal/larger partial with v1=%s count=%s rendered=%s',
    async (v1, count, rendered) => {
      client.getFile.mockResolvedValue(existing(count, rendered, v1));
      expect(await handleSave(settings, incoming())).toMatchObject({
        success: true,
        isNewFile: false,
      });
      expect(client.putFile).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['complete', 'unknown', 'absent'] as const)(
    'preserves %s overwrite behavior',
    async load => {
      const note = incoming();
      if (load === 'absent') delete note.domHistoryLoad;
      else note.domHistoryLoad = load;
      client.getFile.mockResolvedValue(existing(undefined, 3, false));
      expect(await handleSave(settings, note)).toMatchObject({ success: true, isNewFile: false });
      expect(client.putFile).toHaveBeenCalledTimes(1);
    }
  );

  it.each([false, true])(
    'refuses an invalid direct-call incoming count (append=%s) with a fixed code',
    async enableAppendMode => {
      const note = incoming();
      note.frontmatter.message_count = -1;
      client.getFile.mockResolvedValue(existing());
      expect(await handleSave({ ...settings, enableAppendMode }, note)).toEqual({
        success: false,
        error: 'partial-capture-invalid-message-count',
      });
      expect(client.putFile).not.toHaveBeenCalled();
      expect(client.putBinaryFile).not.toHaveBeenCalled();
    }
  );

  it.each([existing(), existing(undefined, 3, false)])(
    'append non-boundary fallback still refuses unsafe overwrite',
    async content => {
      client.getFile
        .mockRejectedValueOnce(new Error('synthetic transient lookup failure'))
        .mockResolvedValue(content);
      const result = await handleSave({ ...settings, enableAppendMode: true }, incoming());
      expect(result.success).toBe(false);
      expect(result.error).toMatch(
        /^partial-capture-(?:would-shrink-note|existing-count-untrusted)$/
      );
      expect(client.putFile).not.toHaveBeenCalled();
      expect(client.putBinaryFile).not.toHaveBeenCalled();
    }
  );

  it.each([2, 3])('append retains its no-op for existing %s >= incoming', async rendered => {
    client.getFile.mockResolvedValue(existing(String(rendered), rendered));
    expect(await handleSave({ ...settings, enableAppendMode: true }, incoming())).toMatchObject({
      success: true,
      messagesAppended: 0,
    });
    expect(client.putFile).not.toHaveBeenCalled();
  });

  it('append boundary errors remain a hard refusal', async () => {
    client.getFile.mockResolvedValue(existing(undefined, 3, false));
    expect(await handleSave({ ...settings, enableAppendMode: true }, incoming())).toEqual({
      success: false,
      error: 'append-message-boundaries-untrusted',
    });
    expect(client.getFile).toHaveBeenCalledTimes(1);
    expect(client.putFile).not.toHaveBeenCalled();
  });

  it.each(['incoming', 'existing'] as const)(
    'preserves fresh-name behavior for an immutable %s snapshot',
    async side => {
      const note = incoming();
      let oldContent = existing(undefined, 3, false);
      if (side === 'incoming') note.frontmatter.archive_capture_id = 'capture-retained';
      else
        oldContent = oldContent.replace(
          '---\nid:',
          '---\narchive_capture_id: capture-retained\nid:'
        );
      client.getFile.mockResolvedValueOnce(oldContent).mockResolvedValueOnce(null);
      const result = await handleSave(settings, note);
      const renamed = candidateFileName(note.fileName, collisionSuffix(note.frontmatter.id), 1);
      expect(result).toMatchObject({ success: true, isNewFile: true, savedAs: renamed });
      expect(client.putFile).toHaveBeenCalledWith(`AI/${renamed}`, expect.any(String));
    }
  );
});
