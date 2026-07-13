import type { ApiUser } from '@/lib/api/types'
import type { ChatContextReadModel } from '@/lib/chat-context/types'

const user: ApiUser = { uid: 'client-1', role: 'client', orgId: 'org-1' }

function readModel(id: string): ChatContextReadModel {
  return {
    context: { kind: 'project', id, orgId: 'org-1', label: 'Launch', icon: 'project' },
    pulse: { label: '1 of 2 complete', metrics: [] },
    groups: [], artifacts: [], attention: [], activity: [], capabilities: ['view'],
    asOf: '2026-07-13T08:00:00.000Z',
  }
}

describe('chat context adapter registry', () => {
  it('dispatches a supported context to its registered adapter', async () => {
    const { createChatContextRegistry } = await import('@/lib/chat-context/registry')
    const project = { resolve: jest.fn().mockResolvedValue({ ok: true, model: readModel('project-1') }) }
    const registry = createChatContextRegistry({ project })

    const result = await registry.resolve({ kind: 'project', id: 'project-1', user })

    expect(project.resolve).toHaveBeenCalledWith({ kind: 'project', id: 'project-1', user })
    expect(result).toMatchObject({ ok: true, model: { context: { id: 'project-1' } } })
  })

  it('returns a typed disabled result for an unregistered Studio adapter', async () => {
    const { createChatContextRegistry } = await import('@/lib/chat-context/registry')
    const registry = createChatContextRegistry({})

    await expect(registry.resolve({ kind: 'studio', id: 'opaque-studio', user })).resolves.toEqual({
      ok: false,
      reason: 'disabled',
      status: 404,
      error: 'Context unavailable',
    })
  })

  it('rejects unsupported context kinds without dispatching an adapter', async () => {
    const { createChatContextRegistry } = await import('@/lib/chat-context/registry')
    const project = { resolve: jest.fn() }
    const registry = createChatContextRegistry({ project })

    await expect(registry.resolve({ kind: 'secret' as never, id: 'value', user })).resolves.toMatchObject({
      ok: false,
      reason: 'unsupported',
      status: 400,
    })
    expect(project.resolve).not.toHaveBeenCalled()
  })
})
