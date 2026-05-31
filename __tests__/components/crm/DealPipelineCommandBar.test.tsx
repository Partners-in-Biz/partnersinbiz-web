import { fireEvent, render, screen } from '@testing-library/react'
import { DealPipelineCommandBar, type DealFocusMode } from '@/components/crm/DealPipelineCommandBar'
import type { Deal } from '@/lib/crm/types'
import type { PipelineStage } from '@/lib/pipelines/types'

const stages: PipelineStage[] = [
  { id: 'qualified', label: 'Qualified', kind: 'open', order: 1, probability: 40, color: '#60a5fa' },
  { id: 'proposal', label: 'Proposal', kind: 'open', order: 2, probability: 75, color: '#facc15' },
  { id: 'won', label: 'Won', kind: 'won', order: 3, probability: 100, color: '#4ade80' },
  { id: 'lost', label: 'Lost', kind: 'lost', order: 4, probability: 0, color: '#ef4444' },
]

function deal(patch: Partial<Deal>): Deal {
  return {
    id: patch.id ?? 'deal-1',
    orgId: 'org-1',
    contactId: patch.contactId ?? 'contact-1',
    title: patch.title ?? 'Growth retainer',
    value: Object.prototype.hasOwnProperty.call(patch, 'value') ? patch.value : 100_000,
    currency: patch.currency ?? 'ZAR',
    pipelineId: 'pipeline-1',
    stageId: patch.stageId ?? 'qualified',
    expectedCloseDate: patch.expectedCloseDate ?? null,
    notes: '',
    createdAt: null,
    updatedAt: null,
    probability: patch.probability,
    lineItems: patch.lineItems,
    companyName: patch.companyName,
    companyId: patch.companyId,
  }
}

describe('DealPipelineCommandBar', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-05-29T10:00:00Z').getTime())
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('summarises pipeline value, risk, missing contacts, and quote readiness', () => {
    render(
      <DealPipelineCommandBar
        deals={[
          deal({ id: 'deal-1', stageId: 'qualified', probability: 40, expectedCloseDate: '2026-05-28T10:00:00Z' as unknown as Deal['expectedCloseDate'] }),
          deal({ id: 'deal-2', stageId: 'proposal', probability: 80, value: 50_000, contactId: '', lineItems: [{ name: 'Audit', qty: 1, unitPrice: 50_000, total: 50_000, currency: 'ZAR' }] }),
          deal({ id: 'deal-3', stageId: 'lost', probability: 0, value: 10_000 }),
        ]}
        stages={stages}
        search=""
        focusMode="all"
        onSearchChange={jest.fn()}
        onFocusModeChange={jest.fn()}
      />,
    )

    expect(screen.getByText('Deal command runway')).toBeInTheDocument()
    expect(screen.getByText(/R\s*80\s*000/)).toBeInTheDocument()
    expect(screen.getByText('1 risky')).toBeInTheDocument()
    expect(screen.getByText('1 missing contact')).toBeInTheDocument()
    expect(screen.getByText('1 quote-ready')).toBeInTheDocument()
  })

  it('names unpriced open pipeline instead of presenting missing deal value as zero', () => {
    render(
      <DealPipelineCommandBar
        deals={[
          deal({ id: 'deal-1', stageId: 'qualified', value: null }),
        ]}
        stages={stages}
        search=""
        focusMode="all"
        onSearchChange={jest.fn()}
        onFocusModeChange={jest.fn()}
      />,
    )

    expect(screen.getByText('Forecast value needed')).toBeInTheDocument()
    expect(screen.getByText('1 unpriced open deal')).toBeInTheDocument()
    expect(screen.queryByText(/R\s*0/)).not.toBeInTheDocument()
  })

  it('drives search and focus filters from the command controls', () => {
    const onSearchChange = jest.fn()
    const onFocusModeChange = jest.fn()

    render(
      <DealPipelineCommandBar
        deals={[deal({ id: 'deal-1', companyName: 'Acme' })]}
        stages={stages}
        search=""
        focusMode="all"
        onSearchChange={onSearchChange}
        onFocusModeChange={onFocusModeChange}
      />,
    )

    fireEvent.change(screen.getByLabelText('Search deals'), { target: { value: 'Acme' } })
    fireEvent.click(screen.getByRole('button', { name: /focus risky deals/i }))
    fireEvent.click(screen.getByRole('button', { name: /focus quote-ready deals/i }))

    expect(onSearchChange).toHaveBeenCalledWith('Acme')
    expect(onFocusModeChange).toHaveBeenNthCalledWith(1, 'atRisk' satisfies DealFocusMode)
    expect(onFocusModeChange).toHaveBeenNthCalledWith(2, 'quoteReady' satisfies DealFocusMode)
  })
})
