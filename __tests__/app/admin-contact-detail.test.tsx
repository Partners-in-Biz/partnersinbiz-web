import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AdminContactDetailPage from '@/app/(admin)/admin/crm/contacts/[id]/page'

const push = jest.fn()
let contactOverride: Record<string, unknown> = {}

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'contact-1' }),
  useRouter: () => ({ push }),
}))

jest.mock('@/components/admin/crm/ActivityTimeline', () => ({
  ActivityTimeline: ({ onAddNote }: { onAddNote?: () => void }) => (
    <div data-testid="activity-timeline">
      {onAddNote && (
        <button type="button" onClick={onAddNote}>
          Log first note from activity timeline
        </button>
      )}
    </div>
  ),
}))

jest.mock('@/components/admin/crm/ContactBrief', () => ({
  __esModule: true,
  default: () => <div data-testid="contact-brief" />,
}))

jest.mock('@/components/admin/crm/ContactForm', () => ({
  ContactForm: () => <div data-testid="contact-form" />,
}))

jest.mock('@/components/crm/CompanyPanel', () => ({
  CompanyPanel: () => <div data-testid="company-panel" />,
}))

jest.mock('@/components/crm/ContactArchiveControl', () => ({
  ContactArchiveControl: () => <div data-testid="archive-control" />,
}))

jest.mock('@/components/crm/ContactDealsPanel', () => ({
  ContactDealsPanel: () => <div data-testid="contact-deals-panel" />,
}))

jest.mock('@/components/crm/ContactIntelligenceStack', () => ({
  ContactIntelligenceStack: () => <div data-testid="contact-intelligence-stack" />,
}))

describe('Admin contact detail page', () => {
  beforeEach(() => {
    push.mockClear()
    contactOverride = {}
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/contacts/contact-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              contact: {
                id: 'contact-1',
                orgId: 'org-1',
                name: 'Jane Client',
                email: 'jane@example.com',
                type: 'lead',
                stage: 'new',
                ...contactOverride,
              },
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/contacts/contact-1/activities') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { activities: [] } }),
        } as Response)
      }
      if (url === '/api/v1/email?contactId=contact-1&limit=8') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [] }),
        } as Response)
      }
      if (url === '/api/v1/crm/contacts/contact-1/suggestions') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { suggestions: [] } }),
        } as Response)
      }
      if (url === '/api/v1/crm/contacts/contact-1/recompute-score') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              update: {
                leadScore: 58,
                icpScore: 72,
                aiLeadScore: 90,
              },
            },
          }),
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response)
    }) as jest.Mock
  })

  it('turns missing admin contact scores into a recompute action', async () => {
    render(<AdminContactDetailPage />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Jane Client' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Recompute score for Jane Client from admin qualification panel' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/contacts/contact-1/recompute-score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeAi: true }),
      })
    })
    await waitFor(() => {
      expect(screen.getAllByText('90').length).toBeGreaterThan(0)
    })
  })

  it('turns empty admin email history into a prefilled compose action', async () => {
    render(<AdminContactDetailPage />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Jane Client' })).toBeInTheDocument()
    })

    const composeLink = screen.getByRole('link', { name: 'Compose first email to Jane Client from admin email history' })
    expect(composeLink).toHaveAttribute('href', '/admin/email/compose?to=jane%40example.com&contactId=contact-1')
  })

  it('keeps the admin header email action inside the in-app composer', async () => {
    render(<AdminContactDetailPage />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Jane Client' })).toBeInTheDocument()
    })

    const headerEmailLink = screen.getByRole('link', { name: 'Email Jane Client from contact command center' })
    expect(headerEmailLink).toHaveAttribute('href', '/admin/email/compose?to=jane%40example.com&contactId=contact-1')
  })

  it('turns a missing admin contact email into a profile completion action', async () => {
    contactOverride = { email: '' }

    render(<AdminContactDetailPage />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Jane Client' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add email for Jane Client from contact command center' }))

    expect(screen.getByTestId('contact-form')).toBeInTheDocument()
  })

  it('turns a missing admin contact phone into a profile completion action', async () => {
    contactOverride = { phone: '' }

    render(<AdminContactDetailPage />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Jane Client' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add phone for Jane Client from contact command center' }))

    expect(screen.getByTestId('contact-form')).toBeInTheDocument()
  })

  it('turns missing admin contact company context into a profile completion action', async () => {
    contactOverride = { company: '', companyId: '', companyName: '' }

    render(<AdminContactDetailPage />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Jane Client' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add company for Jane Client from contact command center' }))

    expect(screen.getByTestId('contact-form')).toBeInTheDocument()
  })

  it('turns empty admin activity history into a note composer action', async () => {
    render(<AdminContactDetailPage />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Jane Client' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Log first note from activity timeline' }))

    expect(screen.getByPlaceholderText('Add an internal note, handoff, decision, or context...')).toHaveFocus()
  })
})
