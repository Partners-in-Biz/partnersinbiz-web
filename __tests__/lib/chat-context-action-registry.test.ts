import {
  chatActionReceiptId,
  collectChatContextActions,
  findAuthoritativeChatContextAction,
  parseSubmittedChatContextAction,
  validateCanonicalActionTarget,
} from '@/lib/chat-context/action-registry'
import type { ChatContextReadModel } from '@/lib/chat-context/types'

const action = {
  id: 'retry-render',
  label: 'Retry render',
  href: '/api/v1/video-editor/renders/render-1/retry',
  method: 'POST' as const,
  body: { quality: 'high', settings: { fps: 30, width: 1920 } },
}

const model: ChatContextReadModel = {
  context: { kind: 'studio_artifact', id: 'video_editor:render-1', orgId: 'org-1', label: 'Launch video', icon: 'movie' },
  pulse: { label: 'Rendering', metrics: [] },
  groups: [{ id: 'jobs', label: 'Jobs', items: [{ id: 'render-1', label: 'Render', state: 'blocked', actions: [action] }] }],
  artifacts: [],
  attention: [],
  activity: [],
  capabilities: [],
  asOf: '2026-07-30T12:00:00.000Z',
}

describe('chat context action registry', () => {
  it('collects executable actions and requires an exact authoritative snapshot', () => {
    expect(collectChatContextActions(model)).toEqual([action])
    expect(findAuthoritativeChatContextAction(model, { ...action })).toEqual(action)
    expect(findAuthoritativeChatContextAction(model, {
      ...action,
      href: '/api/v1/admin/users/delete',
    })).toBeNull()
    expect(findAuthoritativeChatContextAction(model, {
      ...action,
      body: { quality: 'low' },
    })).toBeNull()
  })

  it('normalizes object key order without weakening action equality', () => {
    expect(findAuthoritativeChatContextAction(model, {
      ...action,
      body: { settings: { width: 1920, fps: 30 }, quality: 'high' },
    })).toEqual(action)
  })

  it('rejects malformed, external, recursive, and read-only targets', () => {
    expect(parseSubmittedChatContextAction({ ...action, method: 'GET' })).toBeNull()
    expect(validateCanonicalActionTarget(action)?.pathname).toContain('/video-editor/')
    expect(validateCanonicalActionTarget({ ...action, href: 'https://evil.example/api/v1/delete' })).toBeNull()
    expect(validateCanonicalActionTarget({ ...action, href: '//evil.example/api/v1/delete' })).toBeNull()
    expect(validateCanonicalActionTarget({ ...action, href: '/api/v1/conversations/conv-1/context-actions' })).toBeNull()
  })

  it('scopes deterministic receipt ids to tenant, actor, conversation, and key', () => {
    const base = { orgId: 'org-1', uid: 'user-1', conversationId: 'conv-1', idempotencyKey: 'chat-action-key-123' }
    expect(chatActionReceiptId(base)).toHaveLength(64)
    expect(chatActionReceiptId(base)).toBe(chatActionReceiptId(base))
    expect(chatActionReceiptId({ ...base, uid: 'user-2' })).not.toBe(chatActionReceiptId(base))
    expect(chatActionReceiptId({ ...base, conversationId: 'conv-2' })).not.toBe(chatActionReceiptId(base))
  })
})
