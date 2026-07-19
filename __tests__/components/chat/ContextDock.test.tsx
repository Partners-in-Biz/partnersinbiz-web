import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ContextDock } from '@/components/chat/context/ContextDock'
import type { RuntimeExecution } from '@/components/messages/hermes/RuntimeInspectorRail'

const model = {
  context: { kind: 'studio' as const, id: 's1', orgId: 'o1', label: 'Marketing Studio', icon: 'campaign' },
  pulse: { label: 'Marketing Studio', metrics: [] },
  groups: [{ id: 'empty', label: 'Empty', items: [] }], artifacts: [], attention: [], activity: [], capabilities: [], asOf: '2026-07-13T00:00:00Z',
}

const activeExecution: RuntimeExecution = {
  activeMessage: {
    id: 'msg-run', conversationId: 'conv-1', role: 'assistant', content: '', authorKind: 'agent',
    authorId: 'pip', authorDisplayName: 'Pip', status: 'streaming', runId: 'run-123',
    model: 'openai/gpt-5.5', provider: 'openai',
  },
  events: [{ event: 'tool_call', tool: 'terminal', preview: 'npm test' }],
  selectedRuntime: null,
  catalog: null,
}

const originalMatchMedia = window.matchMedia

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia })
})

it('is an accessible adaptive dock, omits empty sections, closes on Escape, and restores focus', () => {
  const close = jest.fn()
  const { rerender } = render(<><button>Open context</button><ContextDock model={model} open={false} onClose={close} /></>)
  screen.getByRole('button', { name: 'Open context' }).focus()
  rerender(<><button>Open context</button><ContextDock model={model} open onClose={close} compact /></>)
  expect(screen.getByRole('dialog', { name: 'Marketing Studio context' })).toHaveAttribute('data-presentation', 'sheet')
  expect(screen.queryByText('Empty')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Close context dock' })).toHaveFocus()
  expect(screen.getByRole('button', { name: 'Close context dock' })).toHaveClass('focus-visible:ring-2')
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(close).toHaveBeenCalled()
  rerender(<><button>Open context</button><ContextDock model={model} open={false} onClose={close} /></>)
  expect(screen.getByRole('button', { name: 'Open context' })).toHaveFocus()
})

it('routes attention actions through the shared action handler instead of navigating to an API URL', () => {
  const onAction = jest.fn()
  const action = { id: 'retry', label: 'Retry', href: '/api/retry', method: 'PUT' as const }
  render(<ContextDock model={{ ...model, attention: [{ id: 'failed', label: 'Failed', state: 'blocked', actions: [action] }] }} open onClose={jest.fn()} onAction={onAction} />)
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(onAction).toHaveBeenCalledWith(action)
  expect(screen.queryByRole('link', { name: 'Retry' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Retry' })).toHaveClass('min-h-11', 'xl:min-h-0')
})

it('keeps workspace links touch-sized until the xl desktop breakpoint', () => {
  render(<ContextDock model={{ ...model, context: { ...model.context, href: '/portal/studios/s1' } }} open compact onClose={jest.fn()} />)
  expect(screen.getByRole('link', { name: /Open full workspace/i })).toHaveClass('min-h-11', 'xl:min-h-9')
  expect(screen.getByRole('link', { name: /Open full workspace/i })).not.toHaveClass('sm:h-9', 'md:h-9', 'lg:h-9')
})

it('uses a genuinely modal bottom sheet in compact chat and marks the active artifact accessibly', () => {
  const artifact = { id: 'a1', studioKind: 'video_editor' as const, resourceType: 'video', resourceId: 'v1', title: 'Launch cut', artifactKind: 'video' as const, state: 'review' as const, statusLabel: 'In review', href: '/videos/v1', actions: [] }
  render(<ContextDock model={{ ...model, artifacts: [artifact] }} open compact activeArtifactId="a1" onClose={jest.fn()} />)
  const dialog = screen.getByRole('dialog', { name: 'Marketing Studio context' })
  expect(dialog).toHaveAttribute('aria-modal', 'true')
  expect(dialog).toHaveAttribute('data-presentation', 'sheet')
  expect(screen.getByRole('button', { name: 'Inspect Launch cut' })).toHaveAttribute('aria-current', 'true')
})

it('uses a modal sheet in normal Messages on a mobile viewport and traps focus', () => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: jest.fn(() => ({ matches: true, addEventListener: jest.fn(), removeEventListener: jest.fn() })) })
  render(<ContextDock model={model} open onClose={jest.fn()} />)
  const dialog = screen.getByRole('dialog', { name: 'Marketing Studio context' })
  expect(dialog).toHaveAttribute('data-presentation', 'sheet')
  expect(dialog).toHaveAttribute('aria-modal', 'true')
  expect(dialog).toHaveClass('fixed', 'inset-0')
  expect(dialog).toHaveClass('pl-[env(safe-area-inset-left)]', 'pr-[env(safe-area-inset-right)]')
  expect(dialog).not.toHaveClass('sm:top-[8%]', 'sm:bottom-3')
  expect(screen.getByTestId('context-dock-header')).toHaveClass('pt-[max(.5rem,env(safe-area-inset-top))]')
  expect(screen.getByTestId('context-dock-scroll-body')).toHaveClass('pb-[max(.75rem,env(safe-area-inset-bottom))]')
  expect(screen.getByRole('button', { name: 'Close context dock' })).toHaveTextContent('Back to chat')
  const close = screen.getByRole('button', { name: 'Close context dock' })
  fireEvent.keyDown(document, { key: 'Tab' })
  expect(close).toHaveFocus()
})

it('switches between primary and secondary context as one tablet landscape surface', async () => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn(() => ({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() })),
  })
  const secondaryContext = { kind: 'document' as const, id: 'd1', label: 'Launch brief', summary: 'Ready for review' }
  const secondaryModel = {
    ...model,
    context: { kind: 'document' as const, id: 'd1', orgId: 'o1', label: 'Launch brief', icon: 'description' },
    pulse: { label: 'Launch brief', headline: 'Ready for review', metrics: [] },
    groups: [{ id: 'details', label: 'Document details', items: [{ id: 'status', label: 'Ready for review' }] }],
  }
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ data: secondaryModel }) })) as jest.Mock

  render(<ContextDock model={model} open mode="dual" onClose={jest.fn()} secondaryContext={secondaryContext} secondaryOptions={[secondaryContext]} />)

  const dialog = screen.getByRole('dialog', { name: 'Marketing Studio context' })
  expect(dialog).toHaveAttribute('data-presentation', 'canvas')
  expect(screen.queryByRole('button', { name: 'Use dual context canvas' })).not.toBeInTheDocument()
  const primary = screen.getByRole('tab', { name: 'Marketing Studio' })
  const secondary = screen.getByRole('tab', { name: 'Launch brief' })
  expect(primary).toHaveAttribute('aria-selected', 'true')
  expect(secondary).toHaveAttribute('aria-selected', 'false')
  expect(primary).toHaveClass('min-h-11')

  primary.focus()
  fireEvent.keyDown(primary, { key: 'ArrowRight' })

  await waitFor(() => expect(screen.getByRole('dialog', { name: 'Launch brief context' })).toBeInTheDocument())
  expect(secondary).toHaveAttribute('aria-selected', 'true')
  expect(secondary).toHaveFocus()
  expect(await screen.findByText('Document details')).toBeInTheDocument()
  expect(screen.queryByText('Related context')).not.toBeInTheDocument()
  expect(global.fetch).toHaveBeenCalledWith('/api/v1/chat-context/document/d1', expect.objectContaining({ signal: expect.any(AbortSignal) }))

  fireEvent.click(primary)
  expect(screen.getByRole('dialog', { name: 'Marketing Studio context' })).toBeInTheDocument()
  expect(primary).toHaveAttribute('aria-selected', 'true')
})

it('keeps keyboard canvas resizing within the 420 to 640 pixel desktop bounds', () => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: jest.fn((query: string) => ({ matches: query.includes('min-width: 1280px'), addEventListener: jest.fn(), removeEventListener: jest.fn() })) })
  const onCanvasWidthChange = jest.fn()
  const { rerender } = render(<ContextDock model={model} open canvasWidth={640} onCanvasWidthChange={onCanvasWidthChange} onClose={jest.fn()} />)

  fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize context canvas' }), { key: 'ArrowLeft' })
  expect(onCanvasWidthChange).toHaveBeenLastCalledWith(640)

  rerender(<ContextDock model={model} open canvasWidth={420} onCanvasWidthChange={onCanvasWidthChange} onClose={jest.fn()} />)
  fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize context canvas' }), { key: 'ArrowRight' })
  expect(onCanvasWidthChange).toHaveBeenLastCalledWith(420)
})

it('shows active execution inside the same context dock with events and stop permission', () => {
  const onStop = jest.fn()
  render(<ContextDock model={model} open onClose={jest.fn()} execution={{ ...activeExecution, canStop: true, onStop }} />)

  expect(screen.getByRole('region', { name: 'Execution' })).toBeInTheDocument()
  expect(screen.queryByTestId('runtime-inspector-rail')).not.toBeInTheDocument()
  expect(screen.getByText('terminal')).toBeInTheDocument()
  expect(screen.getByText('npm test')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Stop run' }))
  expect(onStop).toHaveBeenCalledTimes(1)
})

it('keeps completed execution collapsed until inspection is requested', () => {
  render(<ContextDock model={model} open onClose={jest.fn()} execution={{ ...activeExecution, activeMessage: { ...activeExecution.activeMessage!, status: 'complete' } }} />)

  expect(screen.getByRole('button', { name: 'Expand execution' })).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText('terminal')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Expand execution' }))
  expect(screen.getByText('terminal')).toBeInTheDocument()
})

it('collapses execution when an active run transitions to completed', () => {
  const { rerender } = render(<ContextDock model={model} open onClose={jest.fn()} execution={activeExecution} />)
  expect(screen.getByRole('button', { name: 'Collapse execution' })).toHaveAttribute('aria-expanded', 'true')
  rerender(<ContextDock model={model} open onClose={jest.fn()} execution={{ ...activeExecution, activeMessage: { ...activeExecution.activeMessage!, status: 'completed' } }} />)
  expect(screen.getByRole('button', { name: 'Expand execution' })).toHaveAttribute('aria-expanded', 'false')
})

it('emphasizes and expands an execution waiting for approval', () => {
  render(<ContextDock model={model} open onClose={jest.fn()} execution={{ ...activeExecution, activeMessage: { ...activeExecution.activeMessage!, status: 'waiting_approval' } }} />)
  expect(screen.getByRole('region', { name: 'Execution' })).toHaveAttribute('data-emphasized', 'true')
  expect(screen.getByRole('button', { name: 'Collapse execution' })).toHaveAttribute('aria-expanded', 'true')
})

it('only renders retry when the caller grants retry permission', () => {
  const onRetry = jest.fn()
  const { rerender } = render(<ContextDock model={model} open onClose={jest.fn()} execution={{ ...activeExecution, activeMessage: { ...activeExecution.activeMessage!, status: 'failed' }, onRetry }} />)
  expect(screen.queryByRole('button', { name: 'Retry run' })).not.toBeInTheDocument()
  rerender(<ContextDock model={model} open onClose={jest.fn()} execution={{ ...activeExecution, activeMessage: { ...activeExecution.activeMessage!, status: 'failed' }, canRetry: true, onRetry }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Retry run' }))
  expect(onRetry).toHaveBeenCalledTimes(1)
})

it('uses the same bottom sheet for execution in compact Briefings chat', () => {
  render(<ContextDock model={model} open compact onClose={jest.fn()} execution={activeExecution} />)
  expect(screen.getByRole('dialog', { name: 'Marketing Studio context' })).toHaveAttribute('data-presentation', 'sheet')
  expect(screen.getByRole('region', { name: 'Execution' })).toBeInTheDocument()
})
