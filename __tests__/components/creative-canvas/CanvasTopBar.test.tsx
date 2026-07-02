/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import CanvasTopBar from '@/components/creative-canvas/topbar/CanvasTopBar'

function renderBar(overrides: Partial<React.ComponentProps<typeof CanvasTopBar>> = {}) {
  const props: React.ComponentProps<typeof CanvasTopBar> = {
    eyebrow: 'Agent creative command',
    title: 'My canvas',
    canRename: false,
    onRename: jest.fn(),
    saveLabel: 'Save graph',
    saving: false,
    saveDisabled: false,
    onSave: jest.fn(),
    autoSaveEnabled: true,
    onToggleAutoSave: jest.fn(),
    presenceCount: 0,
    onOpenChat: jest.fn(),
    onShare: jest.fn(),
    ...overrides,
  }
  render(<CanvasTopBar {...props} />)
  return props
}

describe('CanvasTopBar', () => {
  it('shows a labeled Canvases button that opens the canvas list', () => {
    const onHome = jest.fn()
    renderBar({ onHome })
    const button = screen.getByRole('button', { name: /all canvases/i })
    expect(button).toHaveTextContent('Canvases')
    fireEvent.click(button)
    expect(onHome).toHaveBeenCalled()
  })

  it('shows a New canvas button when creation is allowed', () => {
    const onNewCanvas = jest.fn()
    renderBar({ onHome: jest.fn(), onNewCanvas })
    fireEvent.click(screen.getByRole('button', { name: /new canvas/i }))
    expect(onNewCanvas).toHaveBeenCalled()
  })

  it('hides the New canvas button without a handler', () => {
    renderBar({ onHome: jest.fn() })
    expect(screen.queryByRole('button', { name: /new canvas/i })).toBeNull()
  })
})
