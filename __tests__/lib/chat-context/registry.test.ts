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
    expect(result).toMatchObject({
      ok: true,
      model: {
        context: { id: 'project-1' },
        freshness: {
          mode: 'live',
          authoritative: true,
          source: 'Projects and Kanban',
          refreshedAt: '2026-07-13T08:00:00.000Z',
          refreshIntervalMs: 5000,
          adapterLevel: 'specialized',
          actionLevel: 'inline',
        },
      },
    })
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

  it.each(['marketing_studio', 'video_editor', 'book_studio', 'youtube_studio', 'mobile_apps'])('routes the %s root namespace to its Studio adapter', async (namespace) => {
    const { createStudioRootNamespaceAdapter } = await import('@/lib/chat-context/registry')
    const adapters = Object.fromEntries(['marketing_studio', 'video_editor', 'book_studio', 'youtube_studio', 'mobile_apps'].map((key) => [key, { resolve: jest.fn().mockResolvedValue({ ok: true, model: readModel(key) }) }]))
    const adapter = createStudioRootNamespaceAdapter(adapters as never)

    await adapter.resolve({ kind: 'studio', id: `${namespace}:org-1`, user })

    expect(adapters[namespace].resolve).toHaveBeenCalledWith({ kind: 'studio', id: `${namespace}:org-1`, user })
  })

  it('registers specialized campaign, social, CRM, commerce, product, calendar, and email adapters on the live registry', async () => {
    jest.resetModules()
    jest.doMock('@/lib/chat-context/adapters/campaign', () => ({
      campaignChatContextAdapter: { resolve: jest.fn().mockResolvedValue({ ok: true, model: readModel('camp-1') }) },
    }))
    jest.doMock('@/lib/chat-context/adapters/social', () => ({
      socialChatContextAdapter: { resolve: jest.fn().mockResolvedValue({ ok: true, model: readModel('post-1') }) },
    }))
    jest.doMock('@/lib/chat-context/adapters/crm', () => ({
      crmChatContextAdapter: { resolve: jest.fn().mockResolvedValue({ ok: true, model: readModel('contact-1') }) },
    }))
    jest.doMock('@/lib/chat-context/adapters/commerce', () => ({
      commerceChatContextAdapter: { resolve: jest.fn().mockResolvedValue({ ok: true, model: readModel('invoice-1') }) },
    }))
    jest.doMock('@/lib/chat-context/adapters/product', () => ({
      productChatContextAdapter: { resolve: jest.fn().mockResolvedValue({ ok: true, model: readModel('product-1') }) },
    }))
    jest.doMock('@/lib/chat-context/adapters/calendarEvent', () => ({
      calendarEventChatContextAdapter: { resolve: jest.fn().mockResolvedValue({ ok: true, model: readModel('event-1') }) },
    }))
    jest.doMock('@/lib/chat-context/adapters/email', () => ({
      emailChatContextAdapter: { resolve: jest.fn().mockResolvedValue({ ok: true, model: readModel('email-1') }) },
    }))
    jest.doMock('@/lib/chat-context/adapters/task', () => ({
      taskChatContextAdapter: { resolve: jest.fn().mockResolvedValue({ ok: true, model: readModel('task-1') }) },
    }))
    jest.doMock('@/lib/chat-context/adapters/workspaceBrokerJob', () => ({
      workspaceBrokerJobChatContextAdapter: { resolve: jest.fn().mockResolvedValue({ ok: true, model: readModel('job-1') }) },
    }))
    jest.doMock('@/lib/chat-context/adapters/project', () => ({ projectChatContextAdapter: { resolve: jest.fn() } }))
    jest.doMock('@/lib/chat-context/adapters/marketingStudio', () => ({ marketingStudioChatContextAdapter: { resolve: jest.fn() } }))
    jest.doMock('@/lib/chat-context/adapters/marketingStudioArtifact', () => ({ marketingStudioArtifactChatContextAdapter: { resolve: jest.fn() } }))
    jest.doMock('@/lib/chat-context/adapters/videoEditor', () => ({ videoEditorChatContextAdapter: { resolve: jest.fn() } }))
    jest.doMock('@/lib/chat-context/adapters/mobileApps', () => ({ mobileAppsChatContextAdapter: { resolve: jest.fn() } }))
    jest.doMock('@/lib/chat-context/adapters/bookStudio', () => ({ bookStudioChatContextAdapter: { resolve: jest.fn() } }))
    jest.doMock('@/lib/chat-context/adapters/youtubeStudio', () => ({ youtubeStudioChatContextAdapter: { resolve: jest.fn() } }))
    jest.doMock('@/lib/chat-context/adapters/studioRoot', () => ({ nonMarketingStudioRootChatContextAdapter: { resolve: jest.fn() } }))
    jest.doMock('@/lib/chat-context/adapters/generic', () => ({ genericChatContextAdapter: { resolve: jest.fn() } }))

    const { chatContextRegistry } = await import('@/lib/chat-context/registry')
    const { campaignChatContextAdapter } = await import('@/lib/chat-context/adapters/campaign')
    const { socialChatContextAdapter } = await import('@/lib/chat-context/adapters/social')
    const { crmChatContextAdapter } = await import('@/lib/chat-context/adapters/crm')
    const { commerceChatContextAdapter } = await import('@/lib/chat-context/adapters/commerce')
    const { productChatContextAdapter } = await import('@/lib/chat-context/adapters/product')
    const { calendarEventChatContextAdapter } = await import('@/lib/chat-context/adapters/calendarEvent')
    const { emailChatContextAdapter } = await import('@/lib/chat-context/adapters/email')
    const { taskChatContextAdapter } = await import('@/lib/chat-context/adapters/task')
    const { workspaceBrokerJobChatContextAdapter } = await import('@/lib/chat-context/adapters/workspaceBrokerJob')

    await chatContextRegistry.resolve({ kind: 'campaign', id: 'camp-1', user })
    await chatContextRegistry.resolve({ kind: 'social', id: 'post-1', user })
    await chatContextRegistry.resolve({ kind: 'contact', id: 'contact-1', user })
    await chatContextRegistry.resolve({ kind: 'invoice', id: 'invoice-1', user })
    await chatContextRegistry.resolve({ kind: 'product', id: 'product-1', user })
    await chatContextRegistry.resolve({ kind: 'calendar_event', id: 'event-1', user })
    await chatContextRegistry.resolve({ kind: 'email', id: 'email-1', user })
    await chatContextRegistry.resolve({ kind: 'task', id: 'task-1', projectId: 'project-1', user })
    await chatContextRegistry.resolve({ kind: 'workspace_broker_job', id: 'job-1', user })

    expect(campaignChatContextAdapter.resolve).toHaveBeenCalledWith({ kind: 'campaign', id: 'camp-1', user })
    expect(socialChatContextAdapter.resolve).toHaveBeenCalledWith({ kind: 'social', id: 'post-1', user })
    expect(crmChatContextAdapter.resolve).toHaveBeenCalledWith({ kind: 'contact', id: 'contact-1', user })
    expect(commerceChatContextAdapter.resolve).toHaveBeenCalledWith({ kind: 'invoice', id: 'invoice-1', user })
    expect(productChatContextAdapter.resolve).toHaveBeenCalledWith({ kind: 'product', id: 'product-1', user })
    expect(calendarEventChatContextAdapter.resolve).toHaveBeenCalledWith({ kind: 'calendar_event', id: 'event-1', user })
    expect(emailChatContextAdapter.resolve).toHaveBeenCalledWith({ kind: 'email', id: 'email-1', user })
    expect(taskChatContextAdapter.resolve).toHaveBeenCalledWith({ kind: 'task', id: 'task-1', projectId: 'project-1', user })
    expect(workspaceBrokerJobChatContextAdapter.resolve).toHaveBeenCalledWith({ kind: 'workspace_broker_job', id: 'job-1', user })
  })
})
