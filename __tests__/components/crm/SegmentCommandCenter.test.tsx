import { fireEvent, render, screen } from '@testing-library/react'
import {
  SegmentCommandCenter,
  type SegmentCommandFocus,
  type SegmentCommandSegment,
} from '@/components/crm/SegmentCommandCenter'

const segments: SegmentCommandSegment[] = [
  {
    id: 'seg-hot',
    name: 'Hot proposal leads',
    description: 'Proposal-stage contacts with link activity',
    filters: {
      stage: 'proposal',
      behavioral: [{ type: 'link_clicked', operator: 'at_least', count: 1, windowDays: 30 }],
    },
  },
  {
    id: 'seg-vip',
    name: 'VIP clients',
    description: '',
    filters: {
      type: 'client',
      tags: ['vip'],
      engagement: { minLeadScore: 70 },
    },
  },
  {
    id: 'seg-import',
    name: 'Imported newsletter',
    description: '',
    filters: { source: 'import' },
  },
]

describe('SegmentCommandCenter', () => {
  it('summarises saved audiences, resolved reach, stale counts, and advanced lenses', () => {
    render(
      <SegmentCommandCenter
        segments={segments}
        counts={{ 'seg-hot': 14, 'seg-vip': 8, 'seg-import': null }}
        search=""
        focus="all"
        onSearchChange={jest.fn()}
        onFocusChange={jest.fn()}
      />,
    )

    expect(screen.getByText('Segment command center')).toBeInTheDocument()
    expect(screen.getByText('3 saved audiences')).toBeInTheDocument()
    expect(screen.getByText('22 resolved contacts')).toBeInTheDocument()
    expect(screen.getByText('1 needs refresh')).toBeInTheDocument()
    expect(screen.getByText('2 advanced lenses')).toBeInTheDocument()
  })

  it('drives search and focus controls', () => {
    const onSearchChange = jest.fn()
    const onFocusChange = jest.fn()

    render(
      <SegmentCommandCenter
        segments={segments}
        counts={{ 'seg-hot': 14 }}
        search=""
        focus="all"
        onSearchChange={onSearchChange}
        onFocusChange={onFocusChange}
      />,
    )

    fireEvent.change(screen.getByLabelText('Search segments'), { target: { value: 'VIP' } })
    fireEvent.click(screen.getByRole('button', { name: /focus segments needing refresh/i }))
    fireEvent.click(screen.getByRole('button', { name: /focus advanced segments/i }))

    expect(onSearchChange).toHaveBeenCalledWith('VIP')
    expect(onFocusChange).toHaveBeenNthCalledWith(1, 'needsRefresh' satisfies SegmentCommandFocus)
    expect(onFocusChange).toHaveBeenNthCalledWith(2, 'advanced' satisfies SegmentCommandFocus)
  })
})
