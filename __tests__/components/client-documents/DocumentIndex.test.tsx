import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { DocumentIndex } from '@/components/client-documents/DocumentIndex'
import type { ClientDocument } from '@/lib/client-documents/types'

const document: ClientDocument = {
  id: 'doc-1',
  orgId: 'org-1',
  title: 'Client Proposal',
  type: 'sales_proposal',
  templateId: 'sales_proposal',
  status: 'internal_draft',
  currentVersionId: 'version-1',
  approvalMode: 'formal_acceptance',
  linked: {},
  assumptions: [],
  clientPermissions: {
    canComment: true,
    canSuggest: true,
    canDirectEdit: false,
    canApprove: true,
  },
  shareToken: 'share-1',
  shareEnabled: false,
  editShareEnabled: false,
  createdBy: 'admin-1',
  createdByType: 'user',
  updatedBy: 'admin-1',
  updatedByType: 'user',
  deleted: false,
}

describe('DocumentIndex', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    jest.spyOn(window, 'confirm').mockReturnValue(true)
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { id: 'doc-1', status: 'archived' } }),
    }) as jest.Mock
  })

  it('does not show delete actions unless enabled by the admin surface', () => {
    render(<DocumentIndex documents={[document]} basePath="/admin/documents" />)

    expect(screen.queryByRole('button', { name: /delete client proposal/i })).not.toBeInTheDocument()
  })

  it('archives a document from the admin document card', async () => {
    const onDeleted = jest.fn()
    render(<DocumentIndex documents={[document]} basePath="/admin/documents" canDelete onDeleted={onDeleted} />)

    fireEvent.click(screen.getByRole('button', { name: /delete client proposal/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/client-documents/doc-1', { method: 'DELETE' })
      expect(onDeleted).toHaveBeenCalledWith('doc-1')
    })

    expect(screen.queryByText('Client Proposal')).not.toBeInTheDocument()
  })

  it('renders CRM company and client organisation relationship labels', () => {
    render(
      <DocumentIndex
        documents={[{
          ...document,
          linked: { companyId: 'company-1', clientOrgId: 'client-org' },
        }]}
        basePath="/admin/documents"
        relationshipLabels={{
          'doc-1': {
            companyName: 'Client One CRM',
            clientOrgName: 'Client One Portal',
          },
        }}
      />,
    )

    expect(screen.getByText('Client One CRM')).toBeInTheDocument()
    expect(screen.getByText('Client One Portal')).toBeInTheDocument()
  })

  it('links project and research references from the global admin document card', () => {
    render(
      <DocumentIndex
        documents={[{
          ...document,
          linked: { projectId: 'project-1', researchItemIds: ['research-1'] },
        }]}
        basePath="/admin/documents"
      />,
    )

    const projectLink = screen.getByRole('link', { name: /project/i })
    expect(projectLink).toHaveAttribute('href', '/admin/projects/project-1')
    expect(projectLink).toHaveTextContent('Project')
    expect(projectLink.className).toContain('cursor-pointer')
    expect(projectLink.className).not.toContain('border')
    expect(projectLink.className).not.toContain('rounded')
    expect(screen.getByRole('link', { name: /research item/i })).toHaveAttribute('href', '/admin/research/research-1')
    expect(screen.queryByText('projectId, researchItemIds')).not.toBeInTheDocument()
  })

  it('uses scoped admin and portal routes for linked work objects', () => {
    const { rerender } = render(
      <DocumentIndex
        documents={[{
          ...document,
          linked: { projectId: 'project-1', researchItemIds: ['research-1', 'research-2'] },
        }]}
        basePath="/admin/org/client-one/documents"
      />,
    )

    expect(screen.getByRole('link', { name: /project/i })).toHaveAttribute('href', '/admin/org/client-one/projects/project-1')
    expect(screen.getByRole('link', { name: /research item 1/i })).toHaveAttribute('href', '/admin/org/client-one/research/research-1')
    expect(screen.getByRole('link', { name: /research item 2/i })).toHaveAttribute('href', '/admin/org/client-one/research/research-2')

    rerender(
      <DocumentIndex
        documents={[{
          ...document,
          linked: { projectId: 'project-1', researchItemIds: ['research-1'] },
        }]}
        basePath="/portal/documents"
      />,
    )

    expect(screen.getByRole('link', { name: /project/i })).toHaveAttribute('href', '/portal/projects/project-1')
    expect(screen.getByRole('link', { name: /research item/i })).toHaveAttribute('href', '/portal/research/research-1')
  })

  it('renders prepared-by and recipient party labels', () => {
    render(
      <DocumentIndex
        documents={[document]}
        basePath="/portal/documents"
        partyLabels={{
          'doc-1': {
            creatorCompanyName: 'Partners in Biz',
            creatorContactName: 'Peet Stander',
            recipientCompanyName: 'Client One',
            recipientContactName: 'Jane Client',
          },
        }}
      />,
    )

    expect(screen.getByText('Prepared by')).toBeInTheDocument()
    expect(screen.getByText('Partners in Biz')).toBeInTheDocument()
    expect(screen.getByText('Peet Stander')).toBeInTheDocument()
    expect(screen.getByText('Recipient')).toBeInTheDocument()
    expect(screen.getByText('Client One')).toBeInTheDocument()
    expect(screen.getByText('Jane Client')).toBeInTheDocument()
  })
})
