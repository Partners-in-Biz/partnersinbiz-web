import { act, fireEvent, render, waitFor } from '@testing-library/react'
import {
  DocumentRelationshipChips,
  DocumentRelationshipPanel,
  getClientVisibleOrgIds,
} from '@/components/client-documents/DocumentRelationshipPanel'
import type { ClientDocument } from '@/lib/client-documents/types'

function makeDoc(overrides: Partial<ClientDocument> = {}): ClientDocument {
  return {
    id: 'doc1',
    orgId: 'org-1',
    title: 'Test Doc',
    type: 'sales_proposal',
    templateId: 'tmpl',
    status: 'internal_review',
    linked: {},
    currentVersionId: 'v1',
    approvalMode: 'none',
    clientPermissions: {
      canComment: true,
      canSuggest: true,
      canDirectEdit: false,
      canApprove: true,
    },
    assumptions: [],
    shareToken: 'view-tok',
    shareEnabled: false,
    editShareEnabled: false,
    createdBy: 'u',
    createdByType: 'agent',
    updatedBy: 'u',
    updatedByType: 'agent',
    deleted: false,
    ...overrides,
  } as ClientDocument
}

describe('DocumentRelationshipPanel', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(global as any).fetch = jest.fn()
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  test('shows header/admin metadata chips for linked document relationships', () => {
    const doc = makeDoc({
      linked: {
        companyId: 'company-1',
        companyIds: ['company-1', 'company-2'],
        contactId: 'contact-1',
        clientOrgIds: ['client-org-1', 'client-org-2'],
        projectIds: ['project-1'],
        dealIds: ['deal-1'],
      },
    })

    const { container } = render(<DocumentRelationshipChips document={doc} />)

    expect(container.textContent).toContain('Primary company: company-1')
    expect(container.textContent).toContain('Company: company-2')
    expect(container.textContent).toContain('Primary contact: contact-1')
    expect(container.textContent).toContain('Client org: client-org-1')
    expect(container.textContent).toContain('Client org: client-org-2')
    expect(container.textContent).toContain('Project: project-1')
    expect(container.textContent).toContain('Deal: deal-1')
  })

  test('saves relationship edits through normalised linked fields and preserves scalar primary links', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { refs: [{ id: 'company-2', title: 'Second Company' }] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { updated: ['linked'] } }),
      })

    const onChange = jest.fn()
    const doc = makeDoc({
      linked: {
        companyId: 'company-1',
        companyIds: ['company-1'],
        contactId: 'contact-1',
        contactIds: ['contact-1'],
        clientOrgId: 'client-org-1',
        clientOrgIds: ['client-org-1'],
        campaignId: 'campaign-keep',
      },
    })
    const { getByLabelText, getAllByText, getByText } = render(
      <DocumentRelationshipPanel document={doc} onChange={onChange} />,
    )

    fireEvent.change(getByLabelText('Additional companies'), { target: { value: 'second' } })
    await act(async () => {
      fireEvent.click(getAllByText('Search')[1])
    })
    await waitFor(() => expect(getByText('Second Company')).not.toBeNull())

    fireEvent.click(getByText('Second Company'))
    await act(async () => {
      fireEvent.click(getByText('Save relationships'))
    })

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      '/api/v1/context-references/search?orgId=org-1&q=second&limit=8&type=company',
    )
    const patchCall = (global.fetch as jest.Mock).mock.calls[1]
    expect(patchCall[0]).toBe('/api/v1/client-documents/doc1')
    expect(JSON.parse(patchCall[1].body)).toEqual({
      linked: {
        companyId: 'company-1',
        companyIds: ['company-1', 'company-2'],
        contactId: 'contact-1',
        contactIds: ['contact-1'],
        clientOrgId: 'client-org-1',
        clientOrgIds: ['client-org-1'],
        campaignId: 'campaign-keep',
      },
    })
  })

  test('shows client-visible warning state when linked client orgs include more than one organisation', () => {
    const doc = makeDoc({
      linked: { clientOrgId: 'client-org-1', clientOrgIds: ['client-org-1', 'client-org-2'] },
    })
    const { container } = render(<DocumentRelationshipPanel document={doc} onChange={() => {}} />)

    expect(getClientVisibleOrgIds(doc)).toEqual(['client-org-1', 'client-org-2'])
    expect(container.textContent).toContain('Client-visible warning')
    expect(container.textContent).toContain('2 linked client organisations')
  })
})
