import React from 'react'
import { render } from '@testing-library/react'
import { DonutChart, HorizontalBarChart, StatCardWithChart, TrendAreaChart } from '@/components/ui/Charts'

const responsiveContainerProps: Array<Record<string, unknown>> = []

jest.mock('recharts', () => {
  const passthrough = () => <div />
  return {
    ResponsiveContainer: (props: Record<string, unknown> & { children?: React.ReactNode }) => {
      responsiveContainerProps.push(props)
      return <div data-testid="responsive-container">{props.children}</div>
    },
    BarChart: passthrough,
    Bar: passthrough,
    LineChart: passthrough,
    Line: passthrough,
    AreaChart: passthrough,
    Area: passthrough,
    PieChart: passthrough,
    Pie: passthrough,
    Cell: passthrough,
    XAxis: passthrough,
    YAxis: passthrough,
    CartesianGrid: passthrough,
    Tooltip: passthrough,
    ReferenceLine: passthrough,
  }
})

describe('shared chart wrappers', () => {
  beforeEach(() => {
    responsiveContainerProps.length = 0
  })

  it('seeds responsive chart dimensions so dashboard charts do not warn during first layout', () => {
    render(
      <>
        <StatCardWithChart label="Posts" value={3} data={[{ value: 1 }, { value: 2 }]} />
        <DonutChart data={[{ name: 'Published', value: 3 }]} />
        <HorizontalBarChart data={[{ label: 'LinkedIn', value: 2 }]} />
        <TrendAreaChart data={[{ label: 'Week 1', value: 1 }]} height={160} />
      </>,
    )

    expect(responsiveContainerProps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ initialDimension: { width: 96, height: 56 } }),
        expect.objectContaining({ initialDimension: { width: 320, height: 220 } }),
        expect.objectContaining({ initialDimension: { width: 320, height: 120 } }),
        expect.objectContaining({ initialDimension: { width: 320, height: 160 } }),
      ]),
    )
  })

  it('renders TrendAreaChart as a line (no area fill / gradient defs)', () => {
    const { container } = render(
      <TrendAreaChart data={[{ label: 'Week 1', value: 1 }]} height={160} />,
    )
    expect(container.querySelector('defs')).toBeNull()
    expect(container.innerHTML).not.toMatch(/linearGradient|AreaChart|<Area\b/)
  })
})
