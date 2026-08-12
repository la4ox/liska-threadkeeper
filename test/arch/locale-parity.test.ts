/**
 * Fitness function: the shipped English and Japanese locales stay in parity.
 *
 * Chrome loads locale messages by key, so a missing translation silently falls
 * back to another locale. Keeping the key sets equal makes newly added UI
 * strings visible during review instead of at runtime.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');

interface LocaleMessage {
  message?: unknown;
  placeholders?: Record<string, { content?: unknown }>;
}

type LocaleMessages = Record<string, LocaleMessage>;

function readLocale(locale: string): LocaleMessages {
  return JSON.parse(
    fs.readFileSync(path.join(root, 'src/_locales', locale, 'messages.json'), 'utf-8')
  ) as LocaleMessages;
}

const locales = {
  en: readLocale('en'),
  ja: readLocale('ja'),
};

describe('architecture: EN/JA locale parity', () => {
  it('uses the same message keys regardless of declaration order', () => {
    expect(Object.keys(locales.ja).sort()).toEqual(Object.keys(locales.en).sort());
  });

  it.each(Object.entries(locales))(
    '%s has a non-empty message for every key',
    (locale, messages) => {
      for (const [key, entry] of Object.entries(messages)) {
        expect(entry, `${locale}/${key} must be a message object`).toBeTypeOf('object');
        expect(entry.message, `${locale}/${key} must define a message string`).toBeTypeOf('string');
        expect(
          (entry.message as string).trim(),
          `${locale}/${key} must not have an empty message`
        ).not.toBe('');
      }
    }
  );

  it('uses the same placeholders and valid substitution content', () => {
    for (const key of Object.keys(locales.en)) {
      const english = locales.en[key].placeholders ?? {};
      const japanese = locales.ja[key].placeholders ?? {};
      expect(Object.keys(japanese).sort(), `placeholder drift in ${key}`).toEqual(
        Object.keys(english).sort()
      );

      for (const [name, placeholder] of Object.entries(japanese)) {
        expect(placeholder.content, `ja/${key}/${name} needs substitution content`).toBeTypeOf(
          'string'
        );
        expect((placeholder.content as string).trim()).not.toBe('');
      }
    }
  });
});
