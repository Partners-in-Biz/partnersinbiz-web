import { render, screen } from '@testing-library/react'
import { ChartPart } from '@/components/chat/parts/ChartPart'
import type { ChartPart as ChartPartModel } from '@/lib/chat/parts'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: ResizeObserverStub,
  })
})

const valid: ChartPartModel = {
  type: 'chart',
  kind: 'bar',
  title: 'Monthly signups',
  x: 'month',
  series: [{ key: 'count', label: 'Signups', color: 'var(--sc-accent)' }],
  data: [{ month: 'Jan', count: 12 }, { month: 'Feb', count: 18 }],
}

describe('ChartPart', () => {
  it('renders a valid chart with export buttons', () => {
    render(<ChartPart part={valid} />)
    expect(screen.getByTestId('chart-part')).toBeInTheDocument()
    expect(screen.getByText('Monthly signups')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'PNG' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'CSV' })).toBeInTheDocument()
  })

  it('shows No data when the series is empty', () => {
    render(<ChartPart part={{ ...valid, data: [] }} />)
    expect(screen.getByText('No data')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'PNG' })).not.toBeInTheDocument()
  })
})
