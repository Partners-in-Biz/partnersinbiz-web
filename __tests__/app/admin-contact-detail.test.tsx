import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AdminContactDetailPage from '@/app/(admin)/admin/crm/contacts/[id]/page'

const push = jest.fn()

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'contact-1' }),
  useRouter: () => ({ push }),
}))

jest.mock('@/components/admin/crm/ActivityTimeline', () => ({
  ActivityTimeline: () => <div data-testid="activity-timeline" />,
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
})
