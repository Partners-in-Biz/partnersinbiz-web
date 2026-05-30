import { fireEvent, render, screen } from '@testing-library/react'
import { DealDetailDrawer } from '@/components/crm/DealDetailDrawer'
import type { Deal } from '@/lib/crm/types'
import type { PipelineStage } from '@/lib/pipelines/types'

const stages: PipelineStage[] = [
  { id: 'proposal', label: 'Proposal', kind: 'open', order: 1, probability: 50, color: '#60a5fa' },
]

const deal: Deal = {
  id: 'deal-1',
  orgId: 'org-1',
  title: 'Growth retainer',
  contactId: 'contact-1',
  companyId: 'company-1',
  companyName: 'Acme Growth',
  ownerUid: 'owner-1',
  ownerRef: { uid: 'owner-1', displayName: 'Maya Sales' },
  value: 50000,
  currency: 'ZAR',
  pipelineId: 'pipeline-1',
  stageId: 'proposal',
  expectedCloseDate: '2026-06-15T10:00:00.000Z' as never,
  notes: '',
  createdAt: null,
  updatedAt: null,
  lineItems: [],
}

describe('DealDetailDrawer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn()
  })

  it('shows readable relationship context for the selected deal', () => {
    render(
      <DealDetailDrawer
        deal={deal}
        stages={stages}
        orgId="org-1"
        contactLabel="Ava Owner"
        onClose={jest.fn()}
      />,
    )

    expect(screen.getByText('Relationship context')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ava Owner' })).toHaveAttribute('href', '/portal/contacts/contact-1')
    expect(screen.getByRole('link', { name: 'Acme Growth' })).toHaveAttribute('href', '/portal/companies/company-1')
    expect(screen.getByText('Maya Sales')).toBeInTheDocument()
    expect(screen.getByText(/15 Jun 2026/)).toBeInTheDocument()
  })

  it('turns a missing decision-maker into an edit action', () => {
    const onEdit = jest.fn()
    render(
      <DealDetailDrawer
        deal={{ ...deal, contactId: '' }}
        stages={stages}
        orgId="org-1"
        onClose={jest.fn()}
        onEdit={onEdit}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Link decision-maker for Growth retainer' }))

    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('turns a missing company into an edit action', () => {
    const onEdit = jest.fn()
    render(
      <DealDetailDrawer
        deal={{ ...deal, companyId: '', companyName: '' }}
        stages={stages}
        orgId="org-1"
        onClose={jest.fn()}
        onEdit={onEdit}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Link company for Growth retainer' }))

    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('turns an unassigned deal owner into an accountability edit action', () => {
    const onEdit = jest.fn()
    render(
      <DealDetailDrawer
        deal={{ ...deal, ownerUid: '', ownerRef: undefined }}
        stages={stages}
        orgId="org-1"
        onClose={jest.fn()}
        onEdit={onEdit}
      />,
    )

    expect(screen.getByText('Deal owner missing')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Assign forecast ownership' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'No team member owns this opportunity. Assign an owner so follow-up, forecast review, and handoff accountability are visible before the deal stalls.',
      ),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Assign owner for Growth retainer' }))

    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('turns a missing close date into a forecast hygiene edit action', () => {
    const onEdit = jest.fn()
    render(
      <DealDetailDrawer
        deal={{ ...deal, expectedCloseDate: null }}
        stages={stages}
        orgId="org-1"
        onClose={jest.fn()}
        onEdit={onEdit}
      />,
    )

    expect(screen.getByText('Close date missing')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Set forecast timing' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'No expected close date is captured. Add one so leadership can trust forecast timing, stale-deal reviews, and pipeline commitments.',
      ),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Set close date for Growth retainer' }))

    expect(onEdit).toHaveBeenCalledTimes(1)
  })
})
