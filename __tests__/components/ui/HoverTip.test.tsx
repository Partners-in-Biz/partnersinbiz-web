import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HoverTip } from '@/components/ui/HoverTip'

describe('HoverTip', () => {
  it('shows a floating tooltip with the full label on hover', async () => {
    render(
      <HoverTip label="Partners in Biz Finance, Accounting, Payroll" side="right" delayMs={0}>
        <span>Partners in Biz F…</span>
      </HoverTip>,
    )

    fireEvent.mouseEnter(screen.getByText('Partners in Biz F…'))

    await waitFor(() => {
      const tip = screen.getByTestId('hover-tip')
      expect(tip).toHaveTextContent('Partners in Biz Finance, Accounting, Payroll')
      expect(tip).toHaveClass('bg-[var(--sc-surface)]', 'text-[var(--sc-ink)]', 'rounded-[var(--st-radius,4px)]')
    })
  })

  it('does not render a tip when the label is empty', async () => {
    render(
      <HoverTip label="   " side="right" delayMs={0}>
        <span>Empty label</span>
      </HoverTip>,
    )

    fireEvent.mouseEnter(screen.getByText('Empty label'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByTestId('hover-tip')).toBeNull()
  })
})
