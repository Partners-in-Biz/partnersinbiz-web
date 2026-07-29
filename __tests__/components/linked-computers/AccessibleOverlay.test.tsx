import { render, screen } from '@testing-library/react'
import { AccessibleDialog } from '@/components/linked-computers/AccessibleOverlay'

describe('AccessibleDialog responsive viewport contract', () => {
  it('bounds shared linked-computer dialogs and makes long content scrollable', () => {
    render(
      <AccessibleDialog label="Manage computer" onClose={jest.fn()}>
        <div>Computer settings</div>
      </AccessibleDialog>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Manage computer' })
    // Backdrop must not scroll — that jumps the whole card when focus moves.
    expect(dialog).toHaveClass('overflow-hidden', 'items-end', 'sm:items-center')
    expect(dialog).not.toHaveClass('overflow-y-auto')
    expect(screen.getByTestId('accessible-dialog-panel')).toHaveClass(
      'max-h-[calc(100dvh-1rem)]',
      'min-h-0',
      'overflow-y-auto',
      'overscroll-contain',
      'sm:max-h-[calc(100dvh-2rem)]',
    )
    expect(screen.getByTestId('accessible-dialog-panel')).not.toHaveClass('my-auto')
  })

  it('lets sticky-footer callers override panel overflow without class conflicts', () => {
    render(
      <AccessibleDialog
        label="New conversation"
        onClose={jest.fn()}
        className="flex h-[min(80dvh,calc(100dvh-1rem))] max-h-[calc(100dvh-1rem)] flex-col overflow-hidden sm:max-h-[calc(100dvh-2rem)]"
      >
        <div>Body</div>
      </AccessibleDialog>,
    )

    const panel = screen.getByTestId('accessible-dialog-panel')
    expect(panel).toHaveClass('overflow-hidden', 'flex-col', 'min-h-0')
    expect(panel).not.toHaveClass('overflow-y-auto')
    expect(panel).not.toHaveClass('my-auto')
  })
})
