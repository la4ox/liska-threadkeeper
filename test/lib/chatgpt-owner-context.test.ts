import { describe, expect, it, vi } from 'vitest';
import {
  allowsChatGptAttachmentAcquisition,
  classifyChatGptOwnerContext,
} from '../../src/lib/chatgpt-owner-context';

const aliases = [
  'gizmo_id',
  'gizmoId',
  'project_id',
  'projectId',
  'conversation_template_id',
  'conversationTemplateId',
] as const;

describe('raw-only ChatGPT owner-context attachment policy', () => {
  it.each(['standard', 'custom-gpt', 'project'] as const)(
    'reconciles %s route authority with raw evidence',
    routeFamily => {
      const ordinary = { mapping: {} };
      expect(allowsChatGptAttachmentAcquisition(ordinary, routeFamily)).toBe(
        routeFamily === 'standard'
      );
      expect(
        allowsChatGptAttachmentAcquisition(
          { ...ordinary, project_id: 'private-owner' },
          routeFamily
        )
      ).toBe(false);
      if (routeFamily !== 'standard')
        expect(classifyChatGptOwnerContext(ordinary, routeFamily)).toEqual({
          allowAttachments: false,
          reason: 'nonstandard-route',
        });
    }
  );
  it.each(['direct', 'nested'])('allows only an ordinary %s graph', envelope => {
    const conversation = { mapping: {} };
    const raw = envelope === 'direct' ? conversation : { conversation };
    expect(classifyChatGptOwnerContext(raw)).toEqual({
      allowAttachments: true,
      reason: 'ordinary-conversation',
    });
    expect(allowsChatGptAttachmentAcquisition(raw)).toBe(true);
  });

  it.each(aliases)('checks exact absence and malformed/nonempty %s at both envelopes', field => {
    for (const value of [null, '']) {
      const conversation = { mapping: {}, [field]: value };
      expect(allowsChatGptAttachmentAcquisition(conversation)).toBe(true);
      expect(allowsChatGptAttachmentAcquisition({ conversation })).toBe(true);
    }
    for (const value of ['private-owner-sentinel', ' ', undefined, 0, false, {}, []]) {
      const conversation = { mapping: {}, [field]: value };
      for (const raw of [conversation, { conversation }]) {
        expect(classifyChatGptOwnerContext(raw)).toEqual({
          allowAttachments: false,
          reason: 'owner-context',
        });
        expect(JSON.stringify(classifyChatGptOwnerContext(raw))).not.toContain(
          'private-owner-sentinel'
        );
      }
    }
  });

  it.each([
    { gizmo_id: 'private-one', gizmoId: 'private-two' },
    { project_id: 'private-one', projectId: 'private-two' },
    { conversation_template_id: 'private-one', conversationTemplateId: 'private-two' },
    { gizmo_id: 'private-one', project_id: 'private-two' },
    { gizmo_id: 'private-one', conversation_template_id: 'private-template' },
    { project_id: 'private-one', conversation_template_id: 'private-template' },
  ])('never admits conflicts, combined owners, or a coexisting template %#', evidence => {
    expect(allowsChatGptAttachmentAcquisition({ mapping: {}, ...evidence })).toBe(false);
  });

  it.each(aliases)('rejects unsupported wrapper-root %s evidence', field => {
    for (const value of ['private-owner', undefined, {}, [], false, 0]) {
      expect(
        classifyChatGptOwnerContext({ conversation: { mapping: {} }, [field]: value })
      ).toEqual({
        allowAttachments: false,
        reason: 'wrapper-owner-context',
      });
    }
    for (const value of [null, '']) {
      expect(
        allowsChatGptAttachmentAcquisition({ conversation: { mapping: {} }, [field]: value })
      ).toBe(true);
    }
  });

  it.each(aliases)('rejects owner evidence in a non-graph nested conversation %s', field => {
    for (const value of ['private-owner', undefined, {}, [], false, 0]) {
      expect(
        classifyChatGptOwnerContext({ mapping: {}, conversation: { [field]: value } })
      ).toEqual({
        allowAttachments: false,
        reason: 'wrapper-owner-context',
      });
    }
    for (const value of [null, '']) {
      expect(
        allowsChatGptAttachmentAcquisition({ mapping: {}, conversation: { [field]: value } })
      ).toBe(true);
    }
  });

  it.each([
    null,
    [],
    new Date(),
    {},
    { mapping: [] },
    { mapping: null },
    { mapping: new Date() },
    { conversation: [] },
    { mapping: {}, conversation: null },
    { mapping: {}, conversation: [] },
    { mapping: {}, conversation: new Date() },
    { conversation: { mapping: [] } },
    { mapping: {}, conversation: { mapping: {} } },
    { mapping: {}, conversation: { mapping: null } },
    { mapping: [], conversation: { mapping: {} } },
  ])('fails closed for an invalid or ambiguous graph envelope %#', raw => {
    expect(allowsChatGptAttachmentAcquisition(raw)).toBe(false);
  });

  it('does not traverse message metadata, text, or unrelated nested owner-like keys', () => {
    const raw = {
      mapping: {
        node: {
          message: {
            content: { parts: ['gizmo_id projectId conversationTemplateId'] },
            metadata: { gizmo_id: 'message-local', projectId: {} },
          },
        },
      },
      metadata: { project_id: 'unrelated' },
    };
    expect(allowsChatGptAttachmentAcquisition(raw)).toBe(true);
    expect(allowsChatGptAttachmentAcquisition({ conversation: raw })).toBe(true);
  });

  it('accepts null-prototype records but not an inherited graph', () => {
    expect(
      allowsChatGptAttachmentAcquisition(Object.assign(Object.create(null), { mapping: {} }))
    ).toBe(true);
    expect(allowsChatGptAttachmentAcquisition(Object.create({ mapping: {} }))).toBe(false);
  });

  it('never invokes accessors and fails closed when an envelope or owner field is accessor-backed', () => {
    const ownerGetter = vi.fn(() => null);
    const owner = { mapping: {} } as Record<string, unknown>;
    Object.defineProperty(owner, 'gizmo_id', { enumerable: true, get: ownerGetter });
    expect(allowsChatGptAttachmentAcquisition(owner)).toBe(false);
    expect(ownerGetter).not.toHaveBeenCalled();

    const mappingGetter = vi.fn(() => ({}));
    const envelope = {} as Record<string, unknown>;
    Object.defineProperty(envelope, 'mapping', { enumerable: true, get: mappingGetter });
    expect(allowsChatGptAttachmentAcquisition(envelope)).toBe(false);
    expect(mappingGetter).not.toHaveBeenCalled();

    const conversationGetter = vi.fn(() => ({ mapping: {} }));
    const nested = {} as Record<string, unknown>;
    Object.defineProperty(nested, 'conversation', {
      enumerable: true,
      get: conversationGetter,
    });
    expect(allowsChatGptAttachmentAcquisition(nested)).toBe(false);
    expect(conversationGetter).not.toHaveBeenCalled();
  });
});
