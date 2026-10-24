import { describe, expect, it, vi } from 'vitest';
import {
  DERIVED_BRANCH_HTML_PERSIST_RESPONSE_SCHEMA,
  buildDerivedBranchHtmlPersistResponse,
  isDerivedBranchHtmlPersistResponse,
  snapshotDerivedBranchHtmlPersistResponse,
} from '../../src/lib/derived-branch-persistence-contract';
import type { DurableWriteOutcome, DurableWriteState } from '../../src/lib/types';

const states: DurableWriteState[] = ['confirmed', 'unknown', 'not-dispatched'];
const pair = () =>
  buildDerivedBranchHtmlPersistResponse({ state: 'confirmed' }, { state: 'unknown' });

describe('closed branch HTML persistence observations', () => {
  it('has an explicit distinct response schema', () => {
    expect(DERIVED_BRANCH_HTML_PERSIST_RESPONSE_SCHEMA).toBe(
      'liska-derived-branch-html-persist-response/1'
    );
    expect(pair()).toEqual({
      schema: DERIVED_BRANCH_HTML_PERSIST_RESPONSE_SCHEMA,
      success: false,
      html: { success: true, writeOutcome: { state: 'confirmed' } },
      receipt: { success: false, writeOutcome: { state: 'unknown' } },
    });
  });

  for (const html of states)
    for (const receipt of states) {
      it(`enforces ${html}/${receipt} observations`, () => {
        const valid = html === 'confirmed' || receipt === 'not-dispatched';
        if (!valid) {
          expect(() =>
            buildDerivedBranchHtmlPersistResponse({ state: html }, { state: receipt })
          ).toThrow('derived-branch-html-persist-invalid-outcome');
          return;
        }
        const value = buildDerivedBranchHtmlPersistResponse({ state: html }, { state: receipt });
        expect(value.success).toBe(html === 'confirmed' && receipt === 'confirmed');
        expect(value.html.success).toBe(html === 'confirmed');
        expect(value.receipt.success).toBe(receipt === 'confirmed');
        expect(isDerivedBranchHtmlPersistResponse(value)).toBe(true);
        expect(snapshotDerivedBranchHtmlPersistResponse(value)).toEqual(value);
      });
    }

  it('reconstructs and freezes every accepted observation without sharing caller data', () => {
    const value = structuredClone(pair());
    value.html.writeOutcome.cleanupDeferred = true;
    value.receipt.writeOutcome.cleanupDeferred = true;
    const snapshot = snapshotDerivedBranchHtmlPersistResponse(value)!;
    expect(snapshot).toEqual(value);
    expect(snapshot).not.toBe(value);
    expect(snapshot.html).not.toBe(value.html);
    expect(snapshot.html.writeOutcome).not.toBe(value.html.writeOutcome);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.html)).toBe(true);
    expect(Object.isFrozen(snapshot.receipt.writeOutcome)).toBe(true);
    value.html.writeOutcome.state = 'unknown';
    expect(snapshot.html.writeOutcome.state).toBe('confirmed');
  });

  it.each([
    null,
    undefined,
    [],
    true,
    'confirmed',
    { success: true },
    { results: [{ destination: 'file', success: true }], allSuccessful: true, anySuccessful: true },
  ])('rejects non-contract responses %s', value => {
    expect(snapshotDerivedBranchHtmlPersistResponse(value)).toBeUndefined();
  });

  it('rejects inconsistent success and receipt-before-HTML observations', () => {
    const value = pair();
    const candidates = [
      { ...value, success: true },
      { ...value, html: { ...value.html, success: false } },
      { ...value, receipt: { ...value.receipt, success: true } },
      { ...value, html: { success: false, writeOutcome: { state: 'unknown' } } },
      {
        ...value,
        html: { success: false, writeOutcome: { state: 'not-dispatched' } },
        receipt: { success: true, writeOutcome: { state: 'confirmed' } },
      },
      { ...value, html: { success: 1, writeOutcome: { state: 'confirmed' } } },
    ];
    for (const candidate of candidates)
      expect(isDerivedBranchHtmlPersistResponse(candidate)).toBe(false);
  });

  it('rejects extras, omissions, prototypes, hooks, symbols and accessors at every level', () => {
    const hook = vi.fn(() => {
      throw new Error('private');
    });
    for (const level of ['root', 'write', 'outcome'] as const) {
      const paths = (value: ReturnType<typeof pair>) =>
        level === 'root' ? value : level === 'write' ? value.html : value.html.writeOutcome;
      const candidate = (change: (node: object) => object) => {
        const value = structuredClone(pair());
        const replacement = change(paths(value));
        if (level === 'root') return replacement;
        if (level === 'write') value.html = replacement as typeof value.html;
        else value.html.writeOutcome = replacement as DurableWriteOutcome;
        return value;
      };
      const changes = [
        (node: object) => ({ ...node, error: 'private' }),
        (node: object) => ({ ...node, path: 'private' }),
        (node: object) => ({ ...node, [Symbol('extra')]: true }),
        (node: object) => ({ ...node, toJSON: hook }),
        (node: object) => Object.assign(Object.create({ inherited: true }), node),
        (node: object) =>
          Object.defineProperty(node, Object.keys(node)[0], { enumerable: true, get: hook }),
        (node: object) => Object.defineProperty(node, Object.keys(node)[0], { enumerable: false }),
        (node: object) => {
          delete (node as Record<string, unknown>)[Object.keys(node)[0]];
          return node;
        },
      ];
      for (const change of changes)
        expect(snapshotDerivedBranchHtmlPersistResponse(candidate(change))).toBeUndefined();
    }
    expect(hook).not.toHaveBeenCalled();
  });

  it.each([
    { state: 'bad' },
    { state: 'confirmed', cleanupDeferred: false },
    { state: 'confirmed', private: 'data' },
  ])('builder rejects hostile outcome %s', value => {
    expect(() =>
      buildDerivedBranchHtmlPersistResponse(value as DurableWriteOutcome, {
        state: 'not-dispatched',
      })
    ).toThrow('derived-branch-html-persist-invalid-outcome');
  });
});
