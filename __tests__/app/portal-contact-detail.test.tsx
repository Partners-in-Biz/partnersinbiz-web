import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PortalContactDetailPage from '@/app/(portal)/portal/contacts/[id]/page'

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'contact-1' }),
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('@/components/crm/ContactDealsPanel', () => ({
  ContactDealsPanel: () => <div data-testid="contact-deals-panel" />,
}))

describe('Portal contact detail page', () => {
  beforeEach(() => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/crm/contacts/contact-1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
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
      if (url === '/api/v1/crm/custom-fields?resource=contact') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { definitions: [] } }),
        } as Response)
      }
      if (url === '/api/v1/portal/settings/team') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ members: [] }),
        } as Response)
      }
      if (url === '/api/v1/email?contactId=contact-1&limit=20') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [] }),
        } as Response)
      }
      if (url === '/api/v1/crm/activities?contactId=contact-1&limit=50') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { activities: [] } }),
        } as Response)
      }
      if (url === '/api/v1/crm/contacts/contact-1/suggestions') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { suggestions: [] } }),
        } as Response)
      }
      if (url === '/api/v1/crm/contacts/contact-1/enrollments') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { enrollments: [] } }),
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response)
    }) as jest.Mock
  })

  it('turns an empty email history into a first-email action', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(await screen.findByText('No emails sent or received yet.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Send first email to Jane Client' }))

    expect(screen.getByPlaceholderText('Subject…')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Message…')).toBeInTheDocument()
  })

  it('turns an empty activity timeline into a first-note action', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(await screen.findByText('No activity logged yet.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Log first note for Jane Client' }))

    expect(screen.getByPlaceholderText('Add note notes…')).toBeInTheDocument()
  })

  it('turns a missing company into a profile linking action', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Link company for Jane Client' }))

    expect(screen.getByPlaceholderText('Search companies…')).toHaveFocus()
  })

  it('turns a missing phone into a profile completion action', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add phone for Jane Client' }))

    expect(screen.getByPlaceholderText('+27...')).toHaveFocus()
  })

  it('keeps missing details visible instead of hiding empty fields', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(screen.getByText('No phone captured')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add phone from details for Jane Client' }))

    expect(screen.getByPlaceholderText('+27...')).toHaveFocus()
  })

  it('keeps relationship notes visible as contact detail context', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(screen.getByText('No relationship notes captured')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add relationship notes from details for Jane Client' }))

    expect(screen.getByPlaceholderText('Add a note about this contact…')).toHaveFocus()
  })
})
