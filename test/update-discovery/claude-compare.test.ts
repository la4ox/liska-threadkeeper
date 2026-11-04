// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  CLAUDE_LIST_MARKER_SOURCE,
  CLAUDE_LIST_SCOPE_PREFIX,
  compareClaudeListTokens,
  observeClaudeTerminalListPage,
  type ClaudeListObservedPage,
} from '../../src/update-discovery/claude';

const scopeKey = CLAUDE_LIST_SCOPE_PREFIX + 'a'.repeat(64);
const conversationId = '00000000-0000-4000-8000-000000000001';
function observation(token = 'opaque-token') {
  return { scopeKey, conversationId, marker: { source: CLAUDE_LIST_MARKER_SOURCE, token } };
}
function incomparable(left: unknown, right: unknown, reason: string, limits?: unknown) {
  const result = compareClaudeListTokens(left, right, limits);
  expect(result).toEqual({ kind: 'incomparable', reason });
  expect(Object.isFrozen(result)).toBe(true);
}

describe('Claude opaque list marker comparison', () => {
  it('reports equality only for the same fully qualified scope, conversation and fixed source', () => {
    const left = observation();
    const right = observation();
    const result = compareClaudeListTokens(left, right);
    expect(result).toEqual({ kind: 'same_token' });
    expect(Object.isFrozen(result)).toBe(true);
    expect(left).toEqual(right);
    expect(Object.isFrozen(left)).toBe(false);
  });
  it.each([
    ['2099-01-01', '1900-01-01'],
    ['1900-01-01', '2099-01-01'],
    ['not a date', 'also not a date'],
    ['1', '01'],
    ['e\u0301', '\u00e9'],
    [' token', 'token'],
  ])('reports opaque inequality without ordering %s and %s', (left, right) => {
    const result = compareClaudeListTokens(observation(left), observation(right));
    expect(result).toEqual({ kind: 'different_token' });
    expect(Object.isFrozen(result)).toBe(true);
    expect(compareClaudeListTokens(observation(right), observation(left))).toEqual(result);
    expect(JSON.stringify(result)).not.toMatch(/unchanged|changed|newer|skip|capture|detail/u);
  });
  it.each([' ', '\u0000', '\ud800', 'x'.repeat(256)])('compares exact nonempty token %s', token => {
    expect(compareClaudeListTokens(observation(token), observation(token))).toEqual({
      kind: 'same_token',
    });
  });
  it('compares projected admitted records without an adapter or inherited authorities', () => {
    const page = observeClaudeTerminalListPage({
      request: {
        method: 'GET',
        route: 'chat_conversations_v2',
        query: { limit: 30, offset: 0, archived: false, consistency: 'strong' },
      },
      response: {
        status: 200,
        body: {
          data: [{ uuid: conversationId, updated_at: 'opaque-token' }],
          has_more: false,
        },
      },
      scope: { key: scopeKey, organizationBinding: 'resolved', workspaceBinding: 'resolved' },
    }) as ClaudeListObservedPage;
    expect(
      compareClaudeListTokens({ scopeKey: page.scopeKey, ...page.records[0] }, observation())
    ).toEqual({ kind: 'same_token' });
  });
  it('separates organization/workspace-qualified scope mismatches', () => {
    incomparable(
      observation(),
      { ...observation(), scopeKey: CLAUDE_LIST_SCOPE_PREFIX + 'b'.repeat(64) },
      'scope-mismatch'
    );
  });
  it('separates conversation mismatches', () => {
    incomparable(
      observation(),
      { ...observation(), conversationId: conversationId.replace(/1$/u, '2') },
      'conversation-mismatch'
    );
  });
  it('does not compare absent markers on either or both sides', () => {
    const missing = { scopeKey, conversationId };
    incomparable(missing, observation(), 'missing-marker');
    incomparable(observation(), missing, 'missing-marker');
    incomparable(missing, missing, 'missing-marker');
  });
  it('does not compare a foreign marker source even when both sides use it', () => {
    const foreign = {
      ...observation(),
      marker: { source: 'foreign-source/1', token: 'opaque-token' },
    };
    incomparable(foreign, observation(), 'source-mismatch');
    incomparable(observation(), foreign, 'source-mismatch');
    incomparable(foreign, foreign, 'source-mismatch');
  });
  it.each([
    null,
    undefined,
    [],
    {},
    new Date(),
    { scopeKey },
    { scopeKey, conversationId: 'raw-id' },
    { ...observation(), scopeKey: 'raw-scope' },
    { ...observation(), marker: null },
    { ...observation(), marker: {} },
    { ...observation(), marker: { source: '', token: 'x' } },
    { ...observation(), marker: { source: CLAUDE_LIST_MARKER_SOURCE, token: '' } },
    { ...observation(), marker: { source: CLAUDE_LIST_MARKER_SOURCE, token: 'x'.repeat(257) } },
  ])('uses fixed incomparable outcomes for malformed operands %j', value => {
    incomparable(value, observation(), 'invalid-input');
    incomparable(observation(), value, 'invalid-input');
  });
  it('reads selected own data only and ignores unknown executable or cyclic values', () => {
    const left = observation();
    const getter = vi.fn(() => {
      throw new Error('private');
    });
    for (const value of [left, left.marker]) {
      Object.defineProperty(value, 'toJSON', { get: getter, enumerable: true });
      Object.assign(value, { privateUnknown: value });
    }
    expect(compareClaudeListTokens(left, observation())).toEqual({ kind: 'same_token' });
    expect(getter).not.toHaveBeenCalled();
  });
  it('rejects known accessors without invoking them', () => {
    const getter = vi.fn(() => 'private');
    for (const key of ['scopeKey', 'conversationId', 'marker', 'source', 'token']) {
      const left = observation();
      Object.defineProperty(key === 'source' || key === 'token' ? left.marker : left, key, {
        enumerable: true,
        get: getter,
      });
      incomparable(left, observation(), 'invalid-input');
    }
    expect(getter).not.toHaveBeenCalled();
  });
  it('normalizes observable Proxy failures without reading thrown objects or leaking prose', () => {
    const getter = vi.fn(() => {
      throw new Error('private getter');
    });
    const error = Object.defineProperty({}, 'message', { get: getter });
    const left = new Proxy(observation(), {
      ownKeys: () => {
        throw error;
      },
    });
    incomparable(left, observation(), 'invalid-input');
    expect(getter).not.toHaveBeenCalled();
    const revoked = Proxy.revocable(observation(), {});
    revoked.revoke();
    incomparable(revoked.proxy, observation(), 'invalid-input');
  });
  it('rejects symbols and exotic prototypes in either qualifier or marker objects', () => {
    for (const marker of [false, true]) {
      const left = observation();
      Object.assign(marker ? left.marker : left, { [Symbol('extra')]: true });
      incomparable(left, observation(), 'invalid-input');
      const exotic = observation();
      Object.setPrototypeOf(marker ? exotic.marker : exotic, {});
      incomparable(exotic, observation(), 'invalid-input');
    }
  });
  it('accepts null prototypes and never changes the caller-owned input', () => {
    const left = observation();
    Object.setPrototypeOf(left, null);
    Object.setPrototypeOf(left.marker, null);
    expect(compareClaudeListTokens(left, observation())).toEqual({ kind: 'same_token' });
    expect(Object.getPrototypeOf(left)).toBe(null);
    expect(Object.isFrozen(left)).toBe(false);
  });
  it('applies lowering-only limits to both operands and returns only fixed invalid-input on failure', () => {
    expect(
      compareClaudeListTokens(observation('x'), observation('x'), { maxTokenCodeUnits: 1 })
    ).toEqual({ kind: 'same_token' });
    incomparable(observation('xx'), observation('x'), 'invalid-input', { maxTokenCodeUnits: 1 });
    incomparable(observation('x'), observation('xx'), 'invalid-input', { maxTokenCodeUnits: 1 });
    incomparable(observation(), observation(), 'invalid-input', { maxTokenCodeUnits: 257 });
    incomparable(observation(), observation(), 'invalid-input', {
      maxScopeKeyCodeUnits: scopeKey.length - 1,
    });
  });
});
