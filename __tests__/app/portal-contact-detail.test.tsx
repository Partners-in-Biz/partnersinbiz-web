import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PortalContactDetailPage from '@/app/(portal)/portal/contacts/[id]/page'
import type { CustomFieldDefinition } from '@/lib/customFields/types'

let mockContactCustomFieldDefinitions: CustomFieldDefinition[] = []
let mockSuggestions: Array<{ action: string; reason: string; urgency: 'high' | 'medium' | 'low' }> = []
let mockContactOverrides: Record<string, unknown> = {}
let mockRouterPush = jest.fn()

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'contact-1' }),
  useRouter: () => ({ push: mockRouterPush }),
}))

jest.mock('@/components/crm/ContactDealsPanel', () => ({
  ContactDealsPanel: () => <div data-testid="contact-deals-panel" />,
}))

describe('Portal contact detail page', () => {
  beforeEach(() => {
    mockContactCustomFieldDefinitions = []
    mockSuggestions = []
    mockContactOverrides = {}
    mockRouterPush = jest.fn()
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
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
                ...mockContactOverrides,
              },
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/custom-fields?resource=contact') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { definitions: mockContactCustomFieldDefinitions } }),
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
          json: async () => ({ data: { suggestions: mockSuggestions } }),
        } as Response)
      }
      if (url === '/api/v1/crm/contacts/contact-1/enrollments') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { enrollments: [] } }),
        } as Response)
      }
      if (url === '/api/v1/crm/contacts/contact-1/recompute-score') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              update: {
                leadScore: 64,
                icpScore: 71,
                aiLeadScore: 82,
              },
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/ai/compose-email') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              subject: 'Executive follow-up',
              bodyText: 'Hi Jane, here is the next step we discussed.',
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/crm/contacts/contact-1' && init?.method === 'DELETE') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: {} }),
      } as Response)
    }) as jest.Mock
  })

  it('turns an empty email history into an outreach readiness action', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(await screen.findByRole('heading', { name: 'Start the first outreach thread' })).toBeInTheDocument()
    expect(screen.getByText('Email trail missing')).toBeInTheDocument()
    expect(screen.getByText('Send the first message so future replies, campaign touches, and account history are visible to every team member working this relationship.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Send first email to Jane Client' }))

    expect(screen.getByPlaceholderText('Subject…')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Message…')).toBeInTheDocument()
  })

  it('keeps the portal header email action inside the CRM composer', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Email Jane Client from contact command center' }))

    expect(screen.getByPlaceholderText('Subject…')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Message…')).toBeInTheDocument()
  })

  it('keeps the portal header call action inside the CRM call log', async () => {
    mockContactOverrides = { phone: '+27821234567' }

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Log call with Jane Client from contact command center' }))

    expect(screen.getByPlaceholderText('Add call notes…')).toBeInTheDocument()
  })

  it('renders portal lifecycle values as readable CRM labels', async () => {
    mockContactOverrides = {
      source: 'outreach',
      type: 'prospect',
      stage: 'proposal',
    }

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(screen.getAllByText('Proposal sent').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Prospect').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Outreach').length).toBeGreaterThan(0)
    expect(screen.getByRole('option', { name: 'Proposal sent' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Prospect' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Outreach' })).toBeInTheDocument()
  })

  it('uses an in-page archive confirmation before removing a portal contact', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: /Archive/ }))

    expect(screen.getByRole('heading', { name: 'Archive Jane Client?' })).toBeInTheDocument()
    expect(screen.getByText('This contact will leave the active CRM list, but relationship history stays available for reporting and audit context.')).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/crm/contacts/contact-1', { method: 'DELETE' })

    fireEvent.click(screen.getByRole('button', { name: 'Confirm archive for Jane Client' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/contacts/contact-1', { method: 'DELETE' })
    })
    expect(mockRouterPush).toHaveBeenCalledWith('/portal/contacts')
  })

  it('uses leadership-ready copy for the portal note composer', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Start activity trail for Jane Client' }))

    expect(screen.getByPlaceholderText('Add a relationship note, handoff, or context…')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Add note notes…')).not.toBeInTheDocument()
  })

  it('uses relationship-history copy for the empty activity metric', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(screen.getByText('No relationship history yet')).toBeInTheDocument()
    expect(screen.queryByText('timeline records loaded')).not.toBeInTheDocument()
  })

  it('turns empty sequence enrollment into a nurture workflow action', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(screen.getByRole('heading', { name: 'No nurture workflow enrolled' })).toBeInTheDocument()
    expect(screen.getByText('Enroll Jane Client into a sequence when outreach should happen on a repeatable cadence instead of relying on one-off reminders.')).toBeInTheDocument()
    expect(screen.queryByText('Not enrolled in any sequences.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Choose nurture sequence for Jane Client' }))

    expect(await screen.findByRole('button', { name: 'Enroll contact' })).toBeInTheDocument()
  })

  it('turns an empty activity timeline into a first-note action', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(await screen.findByText('Relationship timeline missing')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Start the first contact note' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'Log the first note, call, email, or meeting so the whole team can see what happened, who followed up, and what should happen next.'
      )
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start activity trail for Jane Client' }))

    expect(screen.getByPlaceholderText('Add a relationship note, handoff, or context…')).toBeInTheDocument()
  })

  it('turns a missing company into a profile linking action', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Link company for Jane Client' }))

    expect(screen.getByPlaceholderText('Search companies…')).toHaveFocus()
  })

  it('turns empty contact custom fields into a focused capture action', async () => {
    mockContactCustomFieldDefinitions = [{
      id: 'field-1',
      orgId: 'org-1',
      resource: 'contact',
      key: 'decision_role',
      label: 'Decision role',
      type: 'text',
      required: false,
      order: 0,
      createdAt: null,
      updatedAt: null,
    }]

    render(<PortalContactDetailPage />)

    expect(await screen.findByText('No custom fields set.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Capture custom fields for Jane Client' }))

    expect(screen.getByLabelText('Decision role')).toHaveFocus()
  })

  it('turns the company card empty state into a company picker action', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Link company from company card for Jane Client' }))

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

  it('turns a missing last touch insight into an activity action', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(screen.getAllByText('No touch logged').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Log touch for Jane Client from last touch insight' }))

    expect(screen.getByPlaceholderText('Add a relationship note, handoff, or context…')).toBeInTheDocument()
  })

  it('turns a follow-up suggestion into a prefilled email action', async () => {
    mockSuggestions = [{
      action: 'Send a follow-up',
      reason: 'No activity in 7+ days',
      urgency: 'high',
    }]

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Start suggested action: Send a follow-up for Jane Client' })[0])

    expect(screen.getByDisplayValue('Send a follow-up')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Message…')).toBeInTheDocument()
  })

  it('turns the command-center next best action into a workflow action', async () => {
    mockSuggestions = [{
      action: 'Send a follow-up',
      reason: 'No activity in 7+ days',
      urgency: 'high',
    }]

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Act on top recommendation: Send a follow-up for Jane Client' }))

    expect(screen.getByDisplayValue('Send a follow-up')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Message…')).toBeInTheDocument()
  })

  it('turns an empty email thread insight into a send action', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Send email to Jane Client from email thread insight' }))

    expect(screen.getByPlaceholderText('Subject…')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Message…')).toBeInTheDocument()
  })

  it('turns an empty activity insight into a note action', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Log activity for Jane Client from activity insight' }))

    expect(screen.getByPlaceholderText('Add a relationship note, handoff, or context…')).toBeInTheDocument()
  })

  it('wires engagement cockpit actions to contact composers', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Schedule meeting from engagement cockpit with Jane Client' }))

    expect(screen.getByPlaceholderText('Meeting title…')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Meeting with Jane Client')).toBeInTheDocument()
  })

  it('keeps activity toolbar actions named by command instead of icon text', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(screen.getByRole('button', { name: 'Call' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Email' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Note' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'SMS' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Meeting' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'AI draft' })).toBeInTheDocument()
  })

  it('moves a generated AI email draft into the CRM email composer', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'AI draft' }))
    fireEvent.change(screen.getByPlaceholderText('Purpose (e.g. Follow up after demo)'), {
      target: { value: 'Follow up after leadership review' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    expect(await screen.findByText('Executive follow-up')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Use AI draft in email composer for Jane Client' }))

    expect(screen.getByDisplayValue('Executive follow-up')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Hi Jane, here is the next step we discussed.')).toBeInTheDocument()
    expect(screen.queryByText('AI email composer')).not.toBeInTheDocument()
  })

  it('turns a missing best score insight into a recompute action', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Recompute score for Jane Client from best score insight' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/contacts/contact-1/recompute-score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeAi: true }),
      })
    })
    await waitFor(() => {
      expect(screen.getAllByText('82').length).toBeGreaterThan(0)
    })
  })

  it('turns an unassigned relationship owner into an accountability action', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Assign owner for Jane Client from relationship ownership' }))

    expect(screen.getByDisplayValue('Unassigned')).toHaveFocus()
  })

  it('turns weak source provenance into a source review action', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(await screen.findByText('Source provenance weak')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Review source provenance for Jane Client from relationship ownership' }))

    expect(screen.getByDisplayValue('Manual entry')).toHaveFocus()
  })

  it('turns missing identity intelligence into profile field actions', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add role for Jane Client from identity intelligence' }))
    expect(screen.getByPlaceholderText('Decision maker, Finance Director...')).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Add department for Jane Client from identity intelligence' }))
    expect(screen.getByPlaceholderText('Finance, Operations...')).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Add timezone for Jane Client from identity intelligence' }))
    expect(screen.getByPlaceholderText('Africa/Johannesburg')).toHaveFocus()
  })
})
