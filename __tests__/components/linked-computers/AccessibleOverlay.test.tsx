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
    expect(dialog).toHaveClass('overflow-hidden')
    expect(screen.getByTestId('accessible-dialog-panel')).toHaveClass(
      'max-h-[calc(100dvh-2rem)]',
      'overflow-y-auto',
      'overscroll-contain',
    )
  })
})
