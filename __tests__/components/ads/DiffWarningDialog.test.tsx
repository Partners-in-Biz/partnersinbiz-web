/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { DiffWarningDialog } from '@/components/ads/DiffWarningDialog'

describe('DiffWarningDialog', () => {
  it('renders nothing when open=false', () => {
    const { container } = render(
      <DiffWarningDialog
        open={false}
        warnings={[{ message: 'x' }]}
        onProceed={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('lists warnings and counts them', () => {
    render(
      <DiffWarningDialog
        open
        warnings={[
          { field: 'objective', message: 'Cannot change on live campaign', severity: 'warning' },
          { message: 'Budget changes apply immediately', severity: 'info' },
        ]}
        onProceed={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByText(/2 issues found/)).toBeInTheDocument()
    expect(screen.getByText('Cannot change on live campaign')).toBeInTheDocument()
    expect(screen.getByText('Budget changes apply immediately')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Review changes' })).toHaveClass('overflow-hidden')
    expect(screen.getByTestId('diff-warning-panel')).toHaveClass('max-h-[calc(100dvh-2rem)]', 'flex-col', 'overflow-hidden')
    expect(screen.getByTestId('diff-warning-list')).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto')
  })

  it('disables Proceed when any warning is an error', () => {
    render(
      <DiffWarningDialog
        open
        warnings={[{ message: 'Boom', severity: 'error' }]}
        proceedLabel="Launch"
        onProceed={() => {}}
        onCancel={() => {}}
      />,
    )
    const proceed = screen.getByRole('button', { name: /Launch/i })
    expect(proceed).toBeDisabled()
  })

  it('calls onCancel and onProceed', () => {
    const onProceed = jest.fn()
    const onCancel = jest.fn()
    render(
      <DiffWarningDialog
        open
        warnings={[{ message: 'ok', severity: 'warning' }]}
        onProceed={onProceed}
        onCancel={onCancel}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }))
    fireEvent.click(screen.getByRole('button', { name: /Proceed/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onProceed).toHaveBeenCalledTimes(1)
  })
})
