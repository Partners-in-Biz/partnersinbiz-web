import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'

import { ChatContextExperience } from '@/components/chat/context/ChatContextExperience'
import { useChatContexts } from '@/components/chat/context/useChatContexts'

const conversation = {
  id: 'conv-1', scope: 'project', scopeRefId: 'project-1',
  contextRefs: [
    { type: 'studio', id: 'studio-1', label: 'Marketing Studio' },
    { type: 'project', id: 'project-1', label: 'Launch' },
  ],
}

const originalMatchMedia = window.matchMedia

afterEach(() => {
  jest.restoreAllMocks()
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia })
})

describe('useChatContexts', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  })

  it('prefers project scope until an explicit conversation-local selection is made', async () => {
    global.fetch = jest.fn(async (input) => ({ ok: true, json: async () => ({ data: { context: { kind: String(input).includes('/project/') ? 'project' : 'studio', id: String(input).split('/').pop(), orgId: 'org-1', label: 'Context', icon: 'folder' }, pulse: { label: 'Context', metrics: [] }, groups: [], artifacts: [], attention: [], activity: [], capabilities: [], asOf: new Date().toISOString() } }) })) as jest.Mock
    const { result, rerender } = renderHook(({ value }) => useChatContexts('org-1', value), { initialProps: { value: conversation } })
    expect(result.current.activeContext).toEqual(expect.objectContaining({ kind: 'project', id: 'project-1' }))
    act(() => result.current.setActiveContext({ kind: 'studio', id: 'studio-1' }))
    expect(result.current.activeContext).toEqual({ kind: 'studio', id: 'studio-1' })
    rerender({ value: { ...conversation, id: 'conv-2' } })
    expect(result.current.activeContext).toEqual(expect.objectContaining({ kind: 'project', id: 'project-1' }))
  })

  it('keeps every resolved conversation reference available to the context canvas', () => {
    global.fetch = jest.fn(() => new Promise(() => {})) as jest.Mock
    const { result } = renderHook(() => useChatContexts('org-1', { ...conversation, contextRefs: [
      ...conversation.contextRefs,
      { type: 'company', id: 'c1', label: 'Company' },
      { type: 'document', id: 'd1', label: 'Brief' },
      { type: 'contact', id: 'person-1', label: 'Theo' },
    ] }))
    expect(result.current.contexts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'company', id: 'c1', label: 'Company' }),
      expect.objectContaining({ kind: 'document', id: 'd1', label: 'Brief' }),
      expect.objectContaining({ kind: 'contact', id: 'person-1', label: 'Theo' }),
    ]))
  })

  it('keeps a pinned project task scoped to its canonical project when fetching the live canvas', async () => {
    const taskConversation = {
      id: 'conv-project-task',
      contextRefs: [{
        type: 'task', id: 'task-in-project', label: 'Approve launch', metadata: { projectId: 'project-1' },
      }],
    }
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ data: {
      context: { kind: 'task', id: 'task-in-project', orgId: 'org-1', label: 'Approve launch', icon: 'task_alt' },
      pulse: { label: 'Task', metrics: [] }, groups: [], artifacts: [], attention: [], activity: [], capabilities: [], asOf: new Date().toISOString(),
    } }) })) as jest.Mock

    const { result } = renderHook(() => useChatContexts('org-1', taskConversation))
    await waitFor(() => expect(result.current.model?.context.id).toBe('task-in-project'))

    expect(result.current.contexts).toEqual([expect.objectContaining({ kind: 'task', id: 'task-in-project', projectId: 'project-1' })])
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/chat-context/task/task-in-project?projectId=project-1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('reloads a linked folder through its conversation-bound context reference', async () => {
    const folderConversation = {
      id: 'conv-linked-folder',
      contextRefs: [{
        type: 'workspace_folder', id: 'workbench-directory:sealed-id', label: 'lp-angular/config-split/ffqved',
        metadata: { contextKind: 'workbench_path', path: 'lp-angular/config-split/ffqved' },
      }],
    }
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ data: {
      context: { kind: 'workspace_folder', id: 'workbench-directory:sealed-id', orgId: 'org-1', label: 'lp-angular/config-split/ffqved', icon: 'folder_open' },
      pulse: { label: 'workspace folder', metrics: [] }, groups: [], artifacts: [], attention: [], activity: [], capabilities: [], asOf: new Date().toISOString(),
    } }) })) as jest.Mock

    const { result } = renderHook(() => useChatContexts('org-1', folderConversation))
    await waitFor(() => expect(result.current.model?.context.id).toBe('workbench-directory:sealed-id'))

    expect(result.current.activeContext).toEqual(expect.objectContaining({ workbenchPath: 'lp-angular/config-split/ffqved' }))
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/chat-context/workspace_folder/workbench-directory%3Asealed-id?conversationId=conv-linked-folder',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('does not dedupe same-id task contexts from different projects or reuse their cached canvas model', async () => {
    const taskConversation = {
      id: 'conv-colliding-project-tasks',
      contextRefs: [
        { type: 'task', id: 'shared-task', label: 'Project one task', metadata: { projectId: 'project-1' } },
        { type: 'task', id: 'shared-task', label: 'Project two task', metadata: { projectId: 'project-2' } },
      ],
    }
    global.fetch = jest.fn(async (input) => {
      const projectId = new URL(String(input), 'http://localhost').searchParams.get('projectId')
      return { ok: true, json: async () => ({ data: {
        context: { kind: 'task', id: 'shared-task', orgId: 'org-1', label: `Task in ${projectId}`, icon: 'task_alt' },
        pulse: { label: 'Task', metrics: [] }, groups: [], artifacts: [], attention: [], activity: [], capabilities: [], asOf: new Date().toISOString(),
      } }) }
    }) as jest.Mock

    const { result } = renderHook(() => useChatContexts('org-1', taskConversation))
    await waitFor(() => expect(result.current.model?.context.label).toBe('Task in project-2'))
    expect(result.current.contexts).toHaveLength(2)

    act(() => result.current.setActiveContext({ kind: 'task', id: 'shared-task', projectId: 'project-1' }))
    await waitFor(() => expect(result.current.model?.context.label).toBe('Task in project-1'))
    expect((global.fetch as jest.Mock).mock.calls.map(([input]) => String(input))).toEqual(expect.arrayContaining([
      '/api/v1/chat-context/task/shared-task?projectId=project-1',
      '/api/v1/chat-context/task/shared-task?projectId=project-2',
    ]))
  })

  it('aborts the previous conversation request before it can update state', async () => {
    global.fetch = jest.fn(() => new Promise(() => {})) as jest.Mock
    const { rerender } = renderHook(({ value }) => useChatContexts('org-1', value), { initialProps: { value: conversation } })
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const firstSignal = (global.fetch as jest.Mock).mock.calls[0][1].signal as AbortSignal
    rerender({ value: { ...conversation, id: 'conv-next' } })
    await waitFor(() => expect(firstSignal.aborted).toBe(true))
  })

  it('keeps the last good model after a transient refresh error', async () => {
    let fail = false
    global.fetch = jest.fn(async () => fail
      ? ({ ok: false, status: 503 } as Response)
      : ({ ok: true, json: async () => ({ data: { context: { kind: 'project', id: 'project-1', orgId: 'org-1', label: 'Launch', icon: 'folder' }, pulse: { label: 'Launch', metrics: [] }, groups: [], artifacts: [], attention: [], activity: [], capabilities: [], asOf: new Date().toISOString() } }) } as Response))
    const { result } = renderHook(() => useChatContexts('org-1', conversation))
    await waitFor(() => expect(result.current.model?.context.label).toBe('Launch'))
    fail = true
    await act(async () => { await result.current.refresh() })
    expect(result.current.model?.context.label).toBe('Launch')
    expect(result.current.error).toBeTruthy()
  })

  it('keys last-good models and routine seen state to each context', async () => {
    const activity = [{ id: 'r1', type: 'running', label: 'Running', occurredAt: '2020-07-13T08:00:00Z' }]
    global.fetch = jest.fn(async (input) => ({ ok: true, json: async () => ({ data: { context: { kind: String(input).includes('/project/') ? 'project' : 'studio', id: String(input).split('/').pop(), orgId: 'org-1', label: String(input).includes('/project/') ? 'Launch' : 'Studio', icon: 'folder' }, pulse: { label: 'Context', metrics: [] }, groups: [], artifacts: [], attention: [], activity, capabilities: [], asOf: new Date().toISOString() } }) })) as jest.Mock
    const { result } = renderHook(() => useChatContexts('org-1', conversation))
    await waitFor(() => expect(result.current.model?.context.label).toBe('Launch'))
    act(() => result.current.dismissRoutineUpdates())
    expect(result.current.routineUpdateCount).toBe(0)
    act(() => result.current.setActiveContext({ kind: 'studio', id: 'studio-1' }))
    expect(result.current.model).toBeNull()
    await waitFor(() => expect(result.current.model?.context.label).toBe('Studio'))
    expect(result.current.routineUpdateCount).toBe(1)
    act(() => result.current.setActiveContext({ kind: 'project', id: 'project-1' }))
    expect(result.current.model?.context.label).toBe('Launch')
    expect(result.current.routineUpdateCount).toBe(0)
  })

  it('executes Dock mutations and refreshes the active context immediately', async () => {
    const refresh = jest.fn(async () => undefined)
    const onActionResolved = jest.fn()
    global.fetch = jest.fn(async () => ({ ok: true })) as jest.Mock
    const model = { context: { kind: 'studio' as const, id: 's1', orgId: 'o1', label: 'Studio', icon: 'campaign' }, pulse: { label: 'Studio', metrics: [] }, groups: [], artifacts: [], attention: [{ id: 'blocked', label: 'Blocked', state: 'blocked' as const, actions: [{ id: 'retry', label: 'Retry', href: '/api/retry', method: 'POST' as const }] }], activity: [], capabilities: [], asOf: '2026-07-13T00:00:00Z' }
    const context = { contexts: [{ kind: 'studio' as const, id: 's1', label: 'Studio' }], activeContext: { kind: 'studio' as const, id: 's1' }, setActiveContext: jest.fn(), model, error: null, refresh, routineUpdateCount: 0, dismissRoutineUpdates: jest.fn() }
    render(<ChatContextExperience context={context} onActionResolved={onActionResolved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open context dock' }))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/retry', expect.objectContaining({ method: 'POST' })))
    expect(refresh).toHaveBeenCalled()
    expect(onActionResolved).toHaveBeenCalledTimes(1)
  })

  it('refreshes a visible related projection after its action succeeds', async () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: jest.fn((query: string) => ({ matches: query.includes('min-width: 1280px'), addEventListener: jest.fn(), removeEventListener: jest.fn() })) })
    window.localStorage.setItem('pib.messages.contextCanvas.v1:org-1:conv-related-action', JSON.stringify({ open: true, mode: 'dual', width: 520, secondary: { kind: 'task', id: 'task-1' } }))
    const refresh = jest.fn(async () => undefined)
    let relatedReads = 0
    const relatedAction = { id: 'complete-task', label: 'Complete task', href: '/api/tasks/task-1/complete', method: 'POST' as const }
    global.fetch = jest.fn(async (input) => {
      if (String(input) === '/api/v1/chat-context/task/task-1') {
        relatedReads += 1
        return { ok: true, json: async () => ({ data: {
          context: { kind: 'task', id: 'task-1', orgId: 'org-1', label: 'Design pilot', icon: 'task_alt' },
          pulse: { label: 'Task', headline: relatedReads === 1 ? 'Waiting for completion' : 'Completed and verified', metrics: [] },
          groups: [], artifacts: [], attention: relatedReads === 1 ? [{ id: 'ready', label: 'Ready to complete', state: 'review', actions: [relatedAction] }] : [], activity: [], capabilities: [], asOf: `2026-07-19T00:00:0${relatedReads}Z`,
        } }) }
      }
      return { ok: true }
    }) as jest.Mock
    const model = { context: { kind: 'project' as const, id: 'project-1', orgId: 'org-1', label: 'Launch', icon: 'target' }, pulse: { label: 'Project', metrics: [] }, groups: [], artifacts: [], attention: [], activity: [], capabilities: [], asOf: '2026-07-19T00:00:00Z' }
    const project = { kind: 'project' as const, id: 'project-1', label: 'Launch' }
    const task = { kind: 'task' as const, id: 'task-1', label: 'Design pilot' }
    const context = { contexts: [project, task], activeContext: project, setActiveContext: jest.fn(), model, error: null, refresh, routineUpdateCount: 0, dismissRoutineUpdates: jest.fn(), orgId: 'org-1', conversationId: 'conv-related-action' }

    render(<ChatContextExperience context={context} />)

    expect(await screen.findByText('Waiting for completion')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Complete task' }))

    await waitFor(() => expect(screen.getByText('Completed and verified')).toBeInTheDocument())
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(global.fetch).toHaveBeenCalledWith('/api/tasks/task-1/complete', expect.objectContaining({ method: 'POST' }))
    expect((global.fetch as jest.Mock).mock.calls.filter(([input]) => String(input) === '/api/v1/chat-context/task/task-1')).toHaveLength(2)
    expect(screen.getByRole('dialog', { name: 'Launch context' })).toHaveAttribute('data-presentation', 'dual')
  })

  it('reports a failed Dock mutation without refreshing or rejecting unhandled', async () => {
    const refresh = jest.fn(async () => undefined)
    global.fetch = jest.fn(async () => ({ ok: false, status: 409 })) as jest.Mock
    const model = { context: { kind: 'studio' as const, id: 's1', orgId: 'o1', label: 'Studio', icon: 'campaign' }, pulse: { label: 'Studio', metrics: [] }, groups: [], artifacts: [], attention: [{ id: 'blocked', label: 'Blocked', state: 'blocked' as const, actions: [{ id: 'retry', label: 'Retry', href: '/api/retry', method: 'POST' as const }] }], activity: [], capabilities: [], asOf: '2026-07-13T00:00:00Z' }
    const context = { contexts: [{ kind: 'studio' as const, id: 's1', label: 'Studio' }], activeContext: { kind: 'studio' as const, id: 's1' }, setActiveContext: jest.fn(), model, error: null, refresh, routineUpdateCount: 0, dismissRoutineUpdates: jest.fn() }
    render(<ChatContextExperience context={context} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open context dock' }))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Context action failed')
    expect(refresh).not.toHaveBeenCalled()
    expect(screen.getAllByText('Studio')).not.toHaveLength(0)
  })

  it('shows a bounded safe API error string for a failed Dock mutation', async () => {
    const refresh = jest.fn(async () => undefined)
    global.fetch = jest.fn(async () => ({ ok: false, status: 422, json: async () => ({ error: `Export blocked: rights review required${'x'.repeat(500)}` }) })) as jest.Mock
    const model = { context: { kind: 'studio' as const, id: 's1', orgId: 'o1', label: 'Studio', icon: 'campaign' }, pulse: { label: 'Studio', metrics: [] }, groups: [], artifacts: [], attention: [{ id: 'blocked', label: 'Blocked', state: 'blocked' as const, actions: [{ id: 'export', label: 'Export', href: '/api/export', method: 'POST' as const }] }], activity: [], capabilities: [], asOf: '2026-07-13T00:00:00Z' }
    const context = { contexts: [{ kind: 'studio' as const, id: 's1', label: 'Studio' }], activeContext: { kind: 'studio' as const, id: 's1' }, setActiveContext: jest.fn(), model, error: null, refresh, routineUpdateCount: 0, dismissRoutineUpdates: jest.fn() }
    render(<ChatContextExperience context={context} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open context dock' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Export blocked: rights review required')
    expect(alert.textContent!.length).toBeLessThanOrEqual(200)
  })

  it('renders an initial load error with a retry action before a model exists', () => {
    const refresh = jest.fn()
    const context = { contexts: [{ kind: 'studio' as const, id: 's1', label: 'Studio' }], activeContext: { kind: 'studio' as const, id: 's1' }, setActiveContext: jest.fn(), model: null, error: new Error('context refresh failed'), refresh, routineUpdateCount: 0, dismissRoutineUpdates: jest.fn() }
    render(<ChatContextExperience context={context} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load context')
    fireEvent.click(screen.getByRole('button', { name: 'Retry context' }))
    expect(refresh).toHaveBeenCalled()
  })

  it('confirms protected actions and deduplicates an in-flight mutation', async () => {
    let resolve!: (value: { ok: boolean }) => void
    global.fetch = jest.fn(() => new Promise((done) => { resolve = done })) as jest.Mock
    jest.spyOn(window, 'confirm').mockReturnValue(true)
    const refresh = jest.fn()
    const action = { id: 'delete', label: 'Delete', href: '/api/delete', method: 'DELETE' as const, destructive: true }
    const model = { context: { kind: 'studio' as const, id: 's1', orgId: 'o1', label: 'Studio', icon: 'campaign' }, pulse: { label: 'Studio', metrics: [] }, groups: [], artifacts: [], attention: [{ id: 'blocked', label: 'Blocked', state: 'blocked' as const, actions: [action] }], activity: [], capabilities: [], asOf: '2026-07-13T00:00:00Z' }
    const context = { contexts: [{ kind: 'studio' as const, id: 's1', label: 'Studio' }], activeContext: { kind: 'studio' as const, id: 's1' }, setActiveContext: jest.fn(), model, error: null, refresh, routineUpdateCount: 0, dismissRoutineUpdates: jest.fn() }
    render(<ChatContextExperience context={context} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open context dock' }))
    const button = screen.getByRole('button', { name: 'Delete' })
    fireEvent.click(button); fireEvent.click(button)
    expect(window.confirm).toHaveBeenCalledTimes(1)
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(button).toBeDisabled()
    await act(async () => resolve({ ok: true }))
  })

  it.each([
    { label: 'successful', response: { ok: true } },
    { label: 'failed', response: { ok: false, status: 500, json: async () => ({ error: 'Source action failed' }) } },
  ])('does not leak a delayed $label action from the source conversation', async ({ response }) => {
    let resolve!: (value: typeof response) => void
    global.fetch = jest.fn(() => new Promise<typeof response>((done) => { resolve = done })) as jest.Mock
    const sourceRefresh = jest.fn()
    const destinationRefresh = jest.fn()
    const action = { id: 'retry', label: 'Retry source', href: '/api/retry-source', method: 'POST' as const }
    const sourceModel = { context: { kind: 'project' as const, id: 'source-project', orgId: 'org-1', label: 'Source project', icon: 'target' }, pulse: { label: 'Project', metrics: [] }, groups: [], artifacts: [], attention: [{ id: 'source-failure', label: 'Source failure', state: 'blocked' as const, actions: [action] }], activity: [], capabilities: [], asOf: '2026-07-19T00:00:00Z' }
    const destinationModel = { ...sourceModel, context: { ...sourceModel.context, id: 'destination-project', label: 'Destination project' }, attention: [] }
    const sourceActive = { kind: 'project' as const, id: 'source-project', label: 'Source project' }
    const destinationActive = { kind: 'project' as const, id: 'destination-project', label: 'Destination project' }
    const shared = { setActiveContext: jest.fn(), error: null, routineUpdateCount: 0, dismissRoutineUpdates: jest.fn(), orgId: 'org-1' }
    const sourceContext = { ...shared, contexts: [sourceActive], activeContext: sourceActive, model: sourceModel, refresh: sourceRefresh, conversationId: 'conv-action-source' }
    const destinationContext = { ...shared, contexts: [destinationActive], activeContext: destinationActive, model: destinationModel, refresh: destinationRefresh, conversationId: 'conv-action-destination' }
    window.localStorage.setItem('pib.messages.contextCanvas.v1:org-1:conv-action-destination', JSON.stringify({ open: true, mode: 'single', width: 520 }))

    const { rerender } = render(<ChatContextExperience context={sourceContext} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open context dock' }))
    fireEvent.click(screen.getByRole('button', { name: 'Retry source' }))

    rerender(<ChatContextExperience context={destinationContext} />)
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Destination project context' })).toBeInTheDocument())

    await act(async () => resolve(response))

    expect(sourceRefresh).not.toHaveBeenCalled()
    expect(destinationRefresh).not.toHaveBeenCalled()
    expect(screen.queryByText('Source action failed')).not.toBeInTheDocument()
    expect(screen.queryByText('Source failure')).not.toBeInTheDocument()
  })

  it.each([
    { label: 'successful', response: { ok: true } },
    { label: 'failed', response: { ok: false, status: 500, json: async () => ({ error: 'Project action failed' }) } },
  ])('does not leak a delayed $label action after changing primary context', async ({ response }) => {
    let resolve!: (value: typeof response) => void
    global.fetch = jest.fn(() => new Promise<typeof response>((done) => { resolve = done })) as jest.Mock
    const projectRefresh = jest.fn()
    const companyRefresh = jest.fn()
    const action = { id: 'retry', label: 'Retry project', href: '/api/retry-project', method: 'POST' as const }
    const projectModel = { context: { kind: 'project' as const, id: 'project-1', orgId: 'org-1', label: 'Launch project', icon: 'target' }, pulse: { label: 'Project', metrics: [] }, groups: [], artifacts: [], attention: [{ id: 'project-failure', label: 'Project failure', state: 'blocked' as const, actions: [action] }], activity: [], capabilities: [], asOf: '2026-07-19T00:00:00Z' }
    const companyModel = { ...projectModel, context: { kind: 'company' as const, id: 'company-1', orgId: 'org-1', label: 'Partners in Biz', icon: 'domain' }, attention: [] }
    const project = { kind: 'project' as const, id: 'project-1', label: 'Launch project' }
    const company = { kind: 'company' as const, id: 'company-1', label: 'Partners in Biz' }
    const shared = { contexts: [project, company], setActiveContext: jest.fn(), error: null, routineUpdateCount: 0, dismissRoutineUpdates: jest.fn(), orgId: 'org-1', conversationId: 'conv-context-switch' }
    const projectContext = { ...shared, activeContext: project, model: projectModel, refresh: projectRefresh }
    const companyContext = { ...shared, activeContext: company, model: companyModel, refresh: companyRefresh }

    const { rerender } = render(<ChatContextExperience context={projectContext} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open context dock' }))
    fireEvent.click(screen.getByRole('button', { name: 'Retry project' }))

    rerender(<ChatContextExperience context={companyContext} />)
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Partners in Biz context' })).toBeInTheDocument())

    await act(async () => resolve(response))

    expect(projectRefresh).not.toHaveBeenCalled()
    expect(companyRefresh).not.toHaveBeenCalled()
    expect(screen.queryByText('Project action failed')).not.toBeInTheDocument()
    expect(screen.queryByText('Project failure')).not.toBeInTheDocument()
  })

  it('restores and persists per-conversation canvas mode, split selection, width, and open state', async () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: jest.fn((query: string) => ({ matches: query.includes('min-width: 1280px'), addEventListener: jest.fn(), removeEventListener: jest.fn() })) })
    window.localStorage.setItem('pib.messages.contextCanvas.v1:org-1:conv-1', JSON.stringify({ open: true, mode: 'dual', width: 610, secondary: { kind: 'company', id: 'company-1' } }))
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ data: { context: { kind: 'company', id: 'company-1', orgId: 'org-1', label: 'Partners in Biz', icon: 'domain' }, pulse: { label: 'Company', metrics: [] }, groups: [], artifacts: [], attention: [], activity: [], capabilities: [], asOf: new Date().toISOString() } }) })) as jest.Mock
    const model = { context: { kind: 'project' as const, id: 'project-1', orgId: 'org-1', label: 'Launch', icon: 'target' }, pulse: { label: 'Project', metrics: [] }, groups: [], artifacts: [], attention: [], activity: [], capabilities: [], asOf: '2026-07-19T00:00:00Z' }
    const contexts = [{ kind: 'project' as const, id: 'project-1', label: 'Launch' }, { kind: 'company' as const, id: 'company-1', label: 'Partners in Biz' }]
    const context = { contexts, activeContext: contexts[0], setActiveContext: jest.fn(), model, error: null, refresh: jest.fn(), routineUpdateCount: 0, dismissRoutineUpdates: jest.fn(), orgId: 'org-1', conversationId: 'conv-1' }

    const onPresentationChange = jest.fn()
    render(<ChatContextExperience context={context} onPresentationChange={onPresentationChange} />)

    const dialog = await screen.findByRole('dialog', { name: 'Launch context' })
    expect(dialog).toHaveAttribute('data-presentation', 'dual')
    expect(screen.getByRole('separator', { name: 'Resize context canvas' })).toHaveAttribute('aria-valuenow', '610')
    expect(screen.getByLabelText('Secondary context')).toHaveValue('company:company-1')
    await waitFor(() => expect(onPresentationChange).toHaveBeenCalledWith({ open: true, mode: 'dual', width: 610 }))
    fireEvent.click(screen.getByRole('button', { name: 'Close context dock' }))
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem('pib.messages.contextCanvas.v1:org-1:conv-1') ?? '{}')).toMatchObject({ open: false, mode: 'dual', width: 610 }))
  })

  it('loads destination canvas state without persisting source state across a conversation change', async () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: jest.fn((query: string) => ({ matches: query.includes('min-width: 1280px'), addEventListener: jest.fn(), removeEventListener: jest.fn() })) })
    const sourceKey = 'pib.messages.contextCanvas.v1:org-1:conv-source'
    const destinationKey = 'pib.messages.contextCanvas.v1:org-1:conv-destination'
    const sourceState = { open: true, mode: 'dual', width: 610, secondary: { kind: 'company', id: 'company-1' } }
    const destinationState = { open: true, mode: 'single', width: 440, secondary: { kind: 'task', id: 'task-1' } }
    window.localStorage.setItem(sourceKey, JSON.stringify(sourceState))
    window.localStorage.setItem(destinationKey, JSON.stringify(destinationState))
    const model = { context: { kind: 'project' as const, id: 'project-1', orgId: 'org-1', label: 'Launch', icon: 'target' }, pulse: { label: 'Project', metrics: [] }, groups: [], artifacts: [], attention: [], activity: [], capabilities: [], asOf: '2026-07-19T00:00:00Z' }
    const contexts = [{ kind: 'project' as const, id: 'project-1', label: 'Launch' }, { kind: 'company' as const, id: 'company-1', label: 'Partners in Biz' }, { kind: 'task' as const, id: 'task-1', label: 'Review launch' }]
    const baseContext = { contexts, activeContext: contexts[0], setActiveContext: jest.fn(), model, error: null, refresh: jest.fn(), routineUpdateCount: 0, dismissRoutineUpdates: jest.fn(), orgId: 'org-1' }

    const { rerender } = render(<ChatContextExperience context={{ ...baseContext, conversationId: 'conv-source' }} />)
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Launch context' })).toHaveAttribute('data-presentation', 'dual'))
    expect(screen.getByRole('separator', { name: 'Resize context canvas' })).toHaveAttribute('aria-valuenow', '610')
    const setItem = jest.spyOn(Storage.prototype, 'setItem')

    rerender(<ChatContextExperience context={{ ...baseContext, conversationId: 'conv-destination' }} />)

    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Launch context' })).toHaveAttribute('data-presentation', 'canvas'))
    expect(screen.getByRole('separator', { name: 'Resize context canvas' })).toHaveAttribute('aria-valuenow', '440')
    expect(JSON.parse(window.localStorage.getItem(destinationKey) ?? '{}')).toEqual(destinationState)
    const destinationWrites = setItem.mock.calls.filter(([key]) => key === destinationKey).map(([, value]) => JSON.parse(String(value)))
    expect(destinationWrites).not.toContainEqual(sourceState)
  })

  it('keeps the destination saved secondary when the source selection is invalid there', async () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: jest.fn((query: string) => ({ matches: query.includes('min-width: 1280px'), addEventListener: jest.fn(), removeEventListener: jest.fn() })) })
    const sourceKey = 'pib.messages.contextCanvas.v1:org-1:conv-source'
    const destinationKey = 'pib.messages.contextCanvas.v1:org-1:conv-destination'
    const sourceState = { open: true, mode: 'dual', width: 610, secondary: { kind: 'contact', id: 'source-contact' } }
    const destinationState = { open: true, mode: 'dual', width: 440, secondary: { kind: 'task', id: 'saved-task' } }
    window.localStorage.setItem(sourceKey, JSON.stringify(sourceState))
    window.localStorage.setItem(destinationKey, JSON.stringify(destinationState))
    const model = { context: { kind: 'project' as const, id: 'project-1', orgId: 'org-1', label: 'Launch', icon: 'target' }, pulse: { label: 'Project', metrics: [] }, groups: [], artifacts: [], attention: [], activity: [], capabilities: [], asOf: '2026-07-19T00:00:00Z' }
    const activeContext = { kind: 'project' as const, id: 'project-1', label: 'Launch' }
    const sharedContext = { kind: 'company' as const, id: 'company-1', label: 'Partners in Biz' }
    const sourceContext = { contexts: [activeContext, { kind: 'contact' as const, id: 'source-contact', label: 'Source contact' }], activeContext, setActiveContext: jest.fn(), model, error: null, refresh: jest.fn(), routineUpdateCount: 0, dismissRoutineUpdates: jest.fn(), orgId: 'org-1', conversationId: 'conv-source' }
    const destinationContext = { ...sourceContext, contexts: [activeContext, sharedContext, { kind: 'task' as const, id: 'saved-task', label: 'Saved task' }], conversationId: 'conv-destination' }

    const { rerender } = render(<ChatContextExperience context={sourceContext} />)
    await waitFor(() => expect(screen.getByLabelText('Secondary context')).toHaveValue('contact:source-contact'))

    rerender(<ChatContextExperience context={destinationContext} />)

    await waitFor(() => expect(screen.getByLabelText('Secondary context')).toHaveValue('task:saved-task'))
    expect(JSON.parse(window.localStorage.getItem(destinationKey) ?? '{}')).toEqual(destinationState)
  })

  it('restores a saved secondary after its lazy relationship arrives without overwriting storage', async () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: jest.fn((query: string) => ({ matches: query.includes('min-width: 1280px'), addEventListener: jest.fn(), removeEventListener: jest.fn() })) })
    const storageKey = 'pib.messages.contextCanvas.v1:org-1:conv-lazy-related'
    const savedState = { open: true, mode: 'dual', width: 560, secondary: { kind: 'task', id: 'saved-related-task' } }
    window.localStorage.setItem(storageKey, JSON.stringify(savedState))
    const setItem = jest.spyOn(Storage.prototype, 'setItem')
    const activeContext = { kind: 'project' as const, id: 'project-1', label: 'Launch' }
    const firstFallback = { kind: 'company' as const, id: 'company-1', label: 'Partners in Biz' }
    const model = { context: { kind: 'project' as const, id: 'project-1', orgId: 'org-1', label: 'Launch', icon: 'target' }, pulse: { label: 'Project', metrics: [] }, groups: [], artifacts: [], attention: [], activity: [], capabilities: [], relationships: [], asOf: '2026-07-19T00:00:00Z' }
    const baseContext = { contexts: [activeContext, firstFallback], activeContext, setActiveContext: jest.fn(), model, error: null, refresh: jest.fn(), routineUpdateCount: 0, dismissRoutineUpdates: jest.fn(), orgId: 'org-1', conversationId: 'conv-lazy-related' }

    const { rerender } = render(<ChatContextExperience context={baseContext} />)

    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Launch context' })).toHaveAttribute('data-presentation', 'dual'))
    expect(screen.getByLabelText('Secondary context')).toHaveValue('company:company-1')
    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? '{}')).toEqual(savedState)

    rerender(<ChatContextExperience context={{ ...baseContext, model: { ...model, relationships: [{ kind: 'task' as const, id: 'saved-related-task', label: 'Saved related task' }] } }} />)

    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Launch context' })).toHaveAttribute('data-presentation', 'dual'))
    await waitFor(() => expect(screen.getByLabelText('Secondary context')).toHaveValue('task:saved-related-task'))
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(storageKey) ?? '{}')).toEqual(savedState))
    const writes = setItem.mock.calls.filter(([key]) => key === storageKey).map(([, value]) => JSON.parse(String(value)))
    expect(writes).not.toHaveLength(0)
    expect(writes).toEqual(writes.map(() => savedState))
  })

  it('keeps a destination saved relationship while its model replaces the stale source model', async () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: jest.fn((query: string) => ({ matches: query.includes('min-width: 1280px'), addEventListener: jest.fn(), removeEventListener: jest.fn() })) })
    const destinationKey = 'pib.messages.contextCanvas.v1:org-1:conv-destination-lazy'
    const destinationState = { open: true, mode: 'dual', width: 570, secondary: { kind: 'task', id: 'destination-task' } }
    window.localStorage.setItem(destinationKey, JSON.stringify(destinationState))
    const setItem = jest.spyOn(Storage.prototype, 'setItem')
    const sourceActive = { kind: 'project' as const, id: 'source-project', label: 'Source project' }
    const destinationActive = { kind: 'project' as const, id: 'destination-project', label: 'Destination project' }
    const fallback = { kind: 'company' as const, id: 'company-1', label: 'Partners in Biz' }
    const sourceModel = { context: { kind: 'project' as const, id: 'source-project', orgId: 'org-1', label: 'Source project', icon: 'target' }, pulse: { label: 'Project', metrics: [] }, groups: [], artifacts: [], attention: [], activity: [], capabilities: [], relationships: [], asOf: '2026-07-19T00:00:00Z' }
    const destinationModel = { ...sourceModel, context: { ...sourceModel.context, id: 'destination-project', label: 'Destination project' }, relationships: [{ kind: 'task' as const, id: 'destination-task', label: 'Destination task' }], asOf: '2026-07-19T00:00:05Z' }
    const shared = { setActiveContext: jest.fn(), error: null, refresh: jest.fn(), routineUpdateCount: 0, dismissRoutineUpdates: jest.fn(), orgId: 'org-1' }
    const sourceContext = { ...shared, contexts: [sourceActive, fallback], activeContext: sourceActive, model: sourceModel, conversationId: 'conv-source-loaded' }
    const destinationLoadingContext = { ...shared, contexts: [destinationActive, fallback], activeContext: destinationActive, model: null, conversationId: 'conv-destination-lazy' }

    const { rerender } = render(<ChatContextExperience context={sourceContext} />)

    rerender(<ChatContextExperience context={{ ...destinationLoadingContext, model: sourceModel }} />)
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Source project context' })).toHaveAttribute('data-presentation', 'dual'))
    expect(screen.getByLabelText('Secondary context')).toHaveValue('company:company-1')
    expect(JSON.parse(window.localStorage.getItem(destinationKey) ?? '{}')).toEqual(destinationState)

    rerender(<ChatContextExperience context={destinationLoadingContext} />)
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(destinationKey) ?? '{}')).toEqual(destinationState))

    rerender(<ChatContextExperience context={{ ...destinationLoadingContext, model: destinationModel }} />)
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Destination project context' })).toHaveAttribute('data-presentation', 'dual'))
    await waitFor(() => expect(screen.getByLabelText('Secondary context')).toHaveValue('task:destination-task'))
    expect(JSON.parse(window.localStorage.getItem(destinationKey) ?? '{}')).toEqual(destinationState)
    const destinationWrites = setItem.mock.calls.filter(([key]) => key === destinationKey).map(([, value]) => JSON.parse(String(value)))
    expect(destinationWrites).not.toHaveLength(0)
    expect(destinationWrites).toEqual(destinationWrites.map(() => destinationState))
  })

  it('settles an unavailable saved secondary without freezing fallback selection or canvas persistence', async () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: jest.fn((query: string) => ({ matches: query.includes('min-width: 1280px'), addEventListener: jest.fn(), removeEventListener: jest.fn() })) })
    const storageKey = 'pib.messages.contextCanvas.v1:org-1:conv-stale-related'
    const staleState = { open: true, mode: 'dual', width: 580, secondary: { kind: 'task', id: 'removed-task' } }
    window.localStorage.setItem(storageKey, JSON.stringify(staleState))
    const activeContext = { kind: 'project' as const, id: 'project-1', label: 'Launch' }
    const company = { kind: 'company' as const, id: 'company-1', label: 'Partners in Biz' }
    const contact = { kind: 'contact' as const, id: 'contact-1', label: 'Theo' }
    const model = { context: { kind: 'project' as const, id: 'project-1', orgId: 'org-1', label: 'Launch', icon: 'target' }, pulse: { label: 'Project', metrics: [] }, groups: [], artifacts: [], attention: [], activity: [], capabilities: [], relationships: [], asOf: '2026-07-19T00:00:00Z' }
    const baseContext = { contexts: [activeContext, company, contact], activeContext, setActiveContext: jest.fn(), model, error: null, refresh: jest.fn(), routineUpdateCount: 0, dismissRoutineUpdates: jest.fn(), orgId: 'org-1', conversationId: 'conv-stale-related' }

    const { rerender } = render(<ChatContextExperience context={baseContext} />)

    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Launch context' })).toHaveAttribute('data-presentation', 'dual'))
    expect(screen.getByLabelText('Secondary context')).toHaveValue('company:company-1')
    fireEvent.click(screen.getByRole('button', { name: 'Close context dock' }))
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(storageKey) ?? '{}')).toEqual({ ...staleState, open: false }))

    rerender(<ChatContextExperience context={{ ...baseContext, model: { ...model, asOf: '2026-07-19T00:00:05Z' } }} />)

    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(storageKey) ?? '{}')).toEqual({ ...staleState, open: false, secondary: { kind: 'company', id: 'company-1' } }))
    fireEvent.click(screen.getByRole('button', { name: 'Open context dock' }))
    fireEvent.change(screen.getByLabelText('Secondary context'), { target: { value: 'contact:contact-1' } })
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(storageKey) ?? '{}')).toEqual({ ...staleState, open: true, secondary: { kind: 'contact', id: 'contact-1' } }))
  })
})
