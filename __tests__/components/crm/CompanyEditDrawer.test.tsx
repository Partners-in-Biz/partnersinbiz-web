import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CompanyEditDrawer } from '@/components/crm/CompanyEditDrawer'
import type { Company } from '@/lib/companies/types'

// ── Mocks ─────────────────────────────────────────────────────────────────────

// CompanyPicker fetches — mock fetch globally
global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ success: true, data: [] }),
})

jest.mock('@/components/crm/CompanyPicker', () => ({
  CompanyPicker: ({ onChange }: { onChange: (v: { companyId: string | null; companyName: string | null }) => void }) => (
    <button type="button" onClick={() => onChange({ companyId: 'co-parent', companyName: 'Parent Co' })}>
      MockCompanyPicker
    </button>
  ),
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const makeCompany = (overrides: Partial<Company> = {}): Partial<Company> => ({
  id: 'co-1',
  orgId: 'org-1',
  name: 'ACME Corp',
  domain: 'acme.com',
  industry: 'SaaS',
  tier: 'enterprise',
  lifecycleStage: 'customer',
  tags: ['vip', 'tech'],
  notes: 'Top account.',
  createdAt: null,
  updatedAt: null,
  ...overrides,
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CompanyEditDrawer', () => {
  const noopClose = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders the drawer in create mode', () => {
    render(
      <CompanyEditDrawer
        mode="create"
        onSave={async () => {}}
        onClose={noopClose}
      />,
    )
    expect(screen.getByText(/New Company/i)).toBeInTheDocument()
  })

  it('renders the drawer in edit mode with company name pre-filled', () => {
    render(
      <CompanyEditDrawer
        company={makeCompany()}
        mode="edit"
        onSave={async () => {}}
        onClose={noopClose}
      />,
    )
    const nameInput = screen.getByLabelText(/Company Name/i) as HTMLInputElement
    expect(nameInput.value).toBe('ACME Corp')
  })

  it('shows a validation error when name is empty on submit', async () => {
    render(
      <CompanyEditDrawer
        mode="create"
        onSave={async () => {}}
        onClose={noopClose}
      />,
    )
    const submitBtn = screen.getByRole('button', { name: /save/i })
    fireEvent.click(submitBtn)
    await waitFor(() => {
      expect(screen.getByText(/name is required/i)).toBeInTheDocument()
    })
  })

  it('calls onSave with the form data when submitted with a valid name', async () => {
    const handleSave = jest.fn().mockResolvedValue(undefined)
    render(
      <CompanyEditDrawer
        mode="create"
        onSave={handleSave}
        onClose={noopClose}
      />,
    )
    fireEvent.change(screen.getByLabelText(/Company Name/i), {
      target: { value: 'New Company Ltd' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => {
      expect(handleSave).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New Company Ltd' }),
      )
    })
  })

  it('preserves the resolved parent company name when saving hierarchy changes', async () => {
    const handleSave = jest.fn().mockResolvedValue(undefined)
    render(
      <CompanyEditDrawer
        mode="create"
        onSave={handleSave}
        onClose={noopClose}
      />,
    )

    fireEvent.change(screen.getByLabelText(/Company Name/i), {
      target: { value: 'Subsidiary Ltd' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'MockCompanyPicker' }))
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(handleSave).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Subsidiary Ltd',
          parentCompanyId: 'co-parent',
          parentCompanyName: 'Parent Co',
        }),
      )
    })
  })

  it('calls onClose when the cancel button in the footer is clicked', () => {
    render(
      <CompanyEditDrawer
        mode="create"
        onSave={async () => {}}
        onClose={noopClose}
      />,
    )
    // There are two close controls: the header X and the footer Cancel button.
    // We click the first one (header X which has aria-label="Cancel").
    const cancelButtons = screen.getAllByRole('button', { name: /cancel/i })
    fireEvent.click(cancelButtons[0])
    expect(noopClose).toHaveBeenCalled()
  })

  it('renders tier dropdown with options', () => {
    render(
      <CompanyEditDrawer
        mode="create"
        onSave={async () => {}}
        onClose={noopClose}
      />,
    )
    expect(screen.getByLabelText(/Tier/i)).toBeInTheDocument()
    expect(screen.getByText('enterprise')).toBeInTheDocument()
    expect(screen.getByText('mid-market')).toBeInTheDocument()
    expect(screen.getByText('smb')).toBeInTheDocument()
  })

  it('renders lifecycle stage dropdown with options', () => {
    render(
      <CompanyEditDrawer
        mode="create"
        onSave={async () => {}}
        onClose={noopClose}
      />,
    )
    expect(screen.getByLabelText(/Lifecycle Stage/i)).toBeInTheDocument()
    expect(screen.getByText('lead')).toBeInTheDocument()
    expect(screen.getByText('prospect')).toBeInTheDocument()
    expect(screen.getByText('customer')).toBeInTheDocument()
    expect(screen.getByText('churned')).toBeInTheDocument()
  })

  it('pre-fills edit mode fields (domain, industry)', () => {
    render(
      <CompanyEditDrawer
        company={makeCompany()}
        mode="edit"
        onSave={async () => {}}
        onClose={noopClose}
      />,
    )
    const domainInput = screen.getByLabelText(/Domain/i) as HTMLInputElement
    expect(domainInput.value).toBe('acme.com')
    const industryInput = screen.getByLabelText(/Industry/i) as HTMLInputElement
    expect(industryInput.value).toBe('SaaS')
  })
})
