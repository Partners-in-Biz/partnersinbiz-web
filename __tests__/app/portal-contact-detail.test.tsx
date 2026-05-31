import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PortalContactDetailPage from '@/app/(portal)/portal/contacts/[id]/page'
import type { CustomFieldDefinition } from '@/lib/customFields/types'

let mockContactCustomFieldDefinitions: CustomFieldDefinition[] = []
let mockSuggestions: Array<{ action: string; reason: string; urgency: 'high' | 'medium' | 'low' }> = []
let mockContactOverrides: Record<string, unknown> = {}
let mockEmails: Array<{ id: string; subject?: string; status?: string; direction?: string; sentAt?: unknown; createdAt?: unknown }> = []
let mockActivities: Array<{ id: string; type?: string; summary?: string; notes?: string; createdAt?: unknown; createdByRef?: { uid?: string; displayName?: string } }> = []
let mockEnrollments: Array<{ id: string; sequenceId: string; sequenceName?: string; currentStep?: number; status?: string }> = []
let mockSequences: Array<{ id: string; name: string }> = []
let mockSequenceEnrollError = ''
let mockSequenceUnenrollError = ''
let mockRouterPush = jest.fn()

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'contact-1' }),
  useRouter: () => ({ push: mockRouterPush }),
}))

jest.mock('@/components/crm/ContactDealsPanel', () => ({
  ContactDealsPanel: ({ contactName }: { contactName?: string }) => (
    <div data-testid="contact-deals-panel">Deals for {contactName || 'contact name missing'}</div>
  ),
}))

describe('Portal contact detail page', () => {
  beforeEach(() => {
    mockContactCustomFieldDefinitions = []
    mockSuggestions = []
    mockContactOverrides = {}
    mockEmails = []
    mockActivities = []
    mockEnrollments = []
    mockSequences = []
    mockSequenceEnrollError = ''
    mockSequenceUnenrollError = ''
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
          json: async () => ({ data: mockEmails }),
        } as Response)
      }
      if (url === '/api/v1/crm/activities?contactId=contact-1&limit=50') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { activities: mockActivities } }),
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
          json: async () => ({ data: { enrollments: mockEnrollments } }),
        } as Response)
      }
      if (url === '/api/v1/crm/sequences') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { sequences: mockSequences } }),
        } as Response)
      }
      if (url === '/api/v1/crm/sequences/seq-1/enrollments' && init?.method === 'POST') {
        return Promise.resolve({
          ok: !mockSequenceEnrollError,
          json: async () => mockSequenceEnrollError
            ? ({ error: mockSequenceEnrollError })
            : ({
                data: {
                  id: 'enrollment-1',
                  sequenceId: 'seq-1',
                  sequenceName: 'Leadership follow-up',
                  currentStep: 0,
                  status: 'active',
                },
              }),
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
      if (url === '/api/v1/crm/sequences/seq-1/enrollments/enrollment-1' && init?.method === 'DELETE') {
        return Promise.resolve({
          ok: !mockSequenceUnenrollError,
          json: async () => mockSequenceUnenrollError ? ({ error: mockSequenceUnenrollError }) : ({ success: true }),
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

  it('turns an empty sequence picker into a setup action', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Choose nurture sequence for Jane Client' }))

    expect(await screen.findByRole('heading', { name: 'Create a sequence before enrolling' })).toBeInTheDocument()
    expect(screen.getByText('This workspace needs at least one nurture sequence before Jane Client can be enrolled from the contact record.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Build first sequence' })).toHaveAttribute('href', '/portal/settings/sequences/new')
    expect(screen.getByRole('button', { name: 'Enroll contact' })).toBeDisabled()
  })

  it('shows sequence enrollment failures inside the modal', async () => {
    mockSequences = [{ id: 'seq-1', name: 'Leadership follow-up' }]
    mockSequenceEnrollError = 'Sequence is paused'

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Choose nurture sequence for Jane Client' }))
    fireEvent.change(await screen.findByDisplayValue('Choose a sequence…'), {
      target: { value: 'seq-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enroll contact' }))

    expect(await screen.findByText('Sequence is paused')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enroll contact' })).toBeEnabled()
    expect(screen.getByText('Leadership follow-up')).toBeInTheDocument()
  })

  it('confirms sequence unenrollment before removing a nurture workflow', async () => {
    mockEnrollments = [{
      id: 'enrollment-1',
      sequenceId: 'seq-1',
      sequenceName: 'Leadership follow-up',
      currentStep: 1,
      status: 'active',
    }]

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(await screen.findByText('Leadership follow-up')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Review unenrollment for Jane Client from Leadership follow-up' }))

    expect(global.fetch).not.toHaveBeenCalledWith('/api/v1/crm/sequences/seq-1/enrollments/enrollment-1', { method: 'DELETE' })
    expect(screen.getByRole('heading', { name: 'Pause this nurture workflow?' })).toBeInTheDocument()
    expect(screen.getByText('Removing Leadership follow-up stops the current sequence steps for Jane Client. The team can re-enroll them later if the follow-up cadence still applies.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm unenroll Jane Client from Leadership follow-up' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/crm/sequences/seq-1/enrollments/enrollment-1', { method: 'DELETE' })
    })
    await waitFor(() => {
      expect(screen.queryByText('Leadership follow-up')).not.toBeInTheDocument()
    })
  })

  it('names incomplete sequence enrollment details instead of exposing raw ids', async () => {
    mockEnrollments = [{
      id: 'enrollment-raw-sequence',
      sequenceId: 'seq-raw-id',
      currentStep: 0,
    }]

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(await screen.findByText('Sequence identity missing')).toBeInTheDocument()
    expect(screen.getByText('Step 1 · Enrollment status not set')).toBeInTheDocument()
    expect(screen.queryByText('seq-raw-id')).not.toBeInTheDocument()
    expect(screen.queryByText(/undefined/i)).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'Review unenrollment for Jane Client from Sequence identity missing',
      })
    ).toBeInTheDocument()
  })

  it('renders sequence enrollment statuses as readable CRM labels', async () => {
    mockEnrollments = [{
      id: 'enrollment-paused',
      sequenceId: 'seq-1',
      sequenceName: 'Leadership follow-up',
      currentStep: 2,
      status: 'paused_by_rule',
    }]

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(await screen.findByText('Leadership follow-up')).toBeInTheDocument()
    expect(screen.getByText('Step 3 · Paused by rule')).toBeInTheDocument()
    expect(screen.queryByText(/paused_by_rule/i)).not.toBeInTheDocument()
  })

  it('shows sequence unenrollment failures without removing the workflow', async () => {
    mockSequenceUnenrollError = 'Enrollment already completed'
    mockEnrollments = [{
      id: 'enrollment-1',
      sequenceId: 'seq-1',
      sequenceName: 'Leadership follow-up',
      currentStep: 1,
      status: 'active',
    }]

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(await screen.findByText('Leadership follow-up')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review unenrollment for Jane Client from Leadership follow-up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm unenroll Jane Client from Leadership follow-up' }))

    expect(await screen.findByText('Enrollment already completed')).toBeInTheDocument()
    expect(screen.getByText('Leadership follow-up')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm unenroll Jane Client from Leadership follow-up' })).toBeEnabled()
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

  it('uses the contact identity fallback across sparse contact workflows', async () => {
    mockContactOverrides = { name: '' }

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByPlaceholderText('Contact name').length).toBeGreaterThan(0)
    })

    expect(screen.getByText('Unnamed contact')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send first email to Unnamed contact' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start activity trail for Unnamed contact' })).toBeInTheDocument()
    expect(screen.getByTestId('contact-deals-panel')).toHaveTextContent('Deals for Unnamed contact')

    fireEvent.click(screen.getByRole('button', { name: 'Schedule meeting from engagement cockpit with Unnamed contact' }))

    expect(screen.getByDisplayValue('Meeting with Unnamed contact')).toBeInTheDocument()
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

  it('names sparse portal next-best-action suggestions instead of rendering blank recommendation cards', async () => {
    mockSuggestions = [{
      action: '',
      reason: '',
      urgency: 'medium',
    }]

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(screen.getAllByText('Suggested action missing').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Suggestion reason missing').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Act on top recommendation: Suggested action missing for Jane Client' }))

    expect(screen.getByPlaceholderText('Add a relationship note, handoff, or context…')).toHaveValue('Suggestion reason missing')
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

  it('names missing command-center KPI values instead of showing bare dashes', async () => {
    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(screen.getByText('Not scored')).toBeInTheDocument()
    expect(screen.getByText('No touch yet')).toBeInTheDocument()
    expect(screen.queryAllByText('—')).toHaveLength(0)
  })

  it('names missing email and activity timestamps on contact history rows', async () => {
    mockEmails = [{
      id: 'email-1',
      subject: 'Proposal follow-up',
      status: 'sent',
      direction: 'outbound',
    }]
    mockActivities = [{
      id: 'activity-1',
      type: 'note',
      summary: 'Discussed implementation handoff',
      createdByRef: { displayName: 'Mandy Manager' },
    }]

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(await screen.findByText('Proposal follow-up')).toBeInTheDocument()
    expect(screen.getByText('sent · Email time not captured')).toBeInTheDocument()
    expect(screen.getByText('Discussed implementation handoff')).toBeInTheDocument()
    expect(screen.getByText('Mandy Manager · Activity time not captured')).toBeInTheDocument()
    expect(screen.queryAllByText('—')).toHaveLength(0)
  })

  it('names incomplete email history rows instead of showing generic placeholders', async () => {
    mockEmails = [{
      id: 'email-sparse',
      subject: '',
      direction: 'outbound',
    }]

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(await screen.findByText('Email subject missing')).toBeInTheDocument()
    expect(screen.getByText('Email status not captured · Email time not captured')).toBeInTheDocument()
    expect(screen.queryByText('(no subject)')).not.toBeInTheDocument()
  })

  it('names incomplete activity timeline rows instead of exposing raw activity snapshots', async () => {
    mockActivities = [{
      id: 'activity-raw',
      type: 'stage_change',
      summary: '',
      notes: '',
      createdByRef: { uid: 'uid-activity-1' },
    }]

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(await screen.findByText('Activity summary missing')).toBeInTheDocument()
    expect(screen.getByText('Activity actor identity missing · Activity time not captured')).toBeInTheDocument()
    expect(screen.queryByText('stage_change')).not.toBeInTheDocument()
    expect(screen.queryByText('uid-activity-1')).not.toBeInTheDocument()
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

  it('names incomplete ownership actor snapshots instead of exposing raw team member ids', async () => {
    mockContactOverrides = {
      assignedTo: 'uid-owner-1',
      assignedToRef: { uid: 'uid-owner-1' },
      source: 'outreach',
      capturedFromId: 'lead_form',
      createdByRef: { uid: 'uid-creator-1' },
      updatedByRef: { uid: 'uid-updater-1' },
    }

    render(<PortalContactDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByDisplayValue('Jane Client').length).toBeGreaterThan(0)
    })

    expect(await screen.findByText('Owner identity missing')).toBeInTheDocument()
    expect(screen.getByText('Creator identity missing')).toBeInTheDocument()
    expect(screen.getByText('Updater identity missing')).toBeInTheDocument()
    expect(screen.getAllByText('Team snapshot details not captured').length).toBeGreaterThanOrEqual(3)
    expect(screen.queryByText('uid-owner-1')).not.toBeInTheDocument()
    expect(screen.queryByText('uid-creator-1')).not.toBeInTheDocument()
    expect(screen.queryByText('uid-updater-1')).not.toBeInTheDocument()
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
