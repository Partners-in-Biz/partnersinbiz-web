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

  it('excludes context kinds without a registered adapter', () => {
    global.fetch = jest.fn(() => new Promise(() => {})) as jest.Mock
    const { result } = renderHook(() => useChatContexts('org-1', { ...conversation, contextRefs: [...conversation.contextRefs, { type: 'company', id: 'c1', label: 'Company' }] }))
    expect(result.current.contexts).not.toContainEqual(expect.objectContaining({ kind: 'company' }))
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
    global.fetch = jest.fn(async () => ({ ok: true })) as jest.Mock
    const model = { context: { kind: 'studio' as const, id: 's1', orgId: 'o1', label: 'Studio', icon: 'campaign' }, pulse: { label: 'Studio', metrics: [] }, groups: [], artifacts: [], attention: [{ id: 'blocked', label: 'Blocked', state: 'blocked' as const, actions: [{ id: 'retry', label: 'Retry', href: '/api/retry', method: 'POST' as const }] }], activity: [], capabilities: [], asOf: '2026-07-13T00:00:00Z' }
    const context = { contexts: [{ kind: 'studio' as const, id: 's1', label: 'Studio' }], activeContext: { kind: 'studio' as const, id: 's1' }, setActiveContext: jest.fn(), model, error: null, refresh, routineUpdateCount: 0, dismissRoutineUpdates: jest.fn() }
    render(<ChatContextExperience context={context} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open context dock' }))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/retry', expect.objectContaining({ method: 'POST' })))
    expect(refresh).toHaveBeenCalled()
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
})
