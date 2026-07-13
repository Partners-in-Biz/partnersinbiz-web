import { fireEvent, render, screen } from '@testing-library/react'
import { ContextDock } from '@/components/chat/context/ContextDock'

const model = {
  context: { kind: 'studio' as const, id: 's1', orgId: 'o1', label: 'Marketing Studio', icon: 'campaign' },
  pulse: { label: 'Marketing Studio', metrics: [] },
  groups: [{ id: 'empty', label: 'Empty', items: [] }], artifacts: [], attention: [], activity: [], capabilities: [], asOf: '2026-07-13T00:00:00Z',
}

it('is an accessible adaptive dock, omits empty sections, closes on Escape, and restores focus', () => {
  const close = jest.fn()
  const { rerender } = render(<><button>Open context</button><ContextDock model={model} open={false} onClose={close} /></>)
  screen.getByRole('button', { name: 'Open context' }).focus()
  rerender(<><button>Open context</button><ContextDock model={model} open onClose={close} compact /></>)
  expect(screen.getByRole('dialog', { name: 'Marketing Studio context' })).toHaveAttribute('data-presentation', 'sheet')
  expect(screen.queryByText('Empty')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Close context dock' })).toHaveFocus()
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
  const close = screen.getByRole('button', { name: 'Close context dock' })
  fireEvent.keyDown(document, { key: 'Tab' })
  expect(close).toHaveFocus()
})
