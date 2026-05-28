import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { DocumentReviewRail } from '@/components/client-documents/DocumentReviewRail'
import type { ClientDocument, DocumentComment } from '@/lib/client-documents/types'
import type { ContextReference } from '@/lib/context-references/types'

const document: ClientDocument = {
  id: 'doc-1',
  orgId: 'org-1',
  title: 'Client Proposal',
  type: 'sales_proposal',
  templateId: 'sales_proposal',
  status: 'client_review',
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

const comments: DocumentComment[] = [
  {
    id: 'comment-open',
    documentId: 'doc-1',
    versionId: 'version-1',
    text: 'Needs a clearer CTA.',
    userId: 'client-1',
    userName: 'Client',
    userRole: 'client',
    status: 'open',
    agentPickedUp: false,
  },
  {
    id: 'comment-resolved',
    documentId: 'doc-1',
    versionId: 'version-1',
    text: 'Resolved typo.',
    userId: 'admin-1',
    userName: 'Admin',
    userRole: 'admin',
    status: 'resolved',
    agentPickedUp: false,
  },
]

const contextRef: ContextReference = {
  type: 'contact',
  id: 'contact-1',
  orgId: 'org-1',
  label: 'Jane Client',
  origin: 'mention',
  href: '/admin/crm/contacts/contact-1',
  summary: 'jane@example.com',
}

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/api/v1/context-references/search')) {
      return {
        ok: true,
        json: async () => ({ success: true, data: { refs: [contextRef] } }),
      } as Response
    }
    throw new Error(`Unexpected fetch ${url}`)
  })
})

describe('DocumentReviewRail', () => {
  it('uses the shared segmented tabs for comment filters', () => {
    render(<DocumentReviewRail document={document} comments={comments} />)

    expect(screen.getByRole('tablist', { name: 'Document comment filters' })).toHaveClass('pib-tabs', 'pib-tabs-segmented')
    expect(screen.getByRole('tab', { name: /Open/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /All/ })).toBeInTheDocument()
  })

  it('passes selected context refs with reply submissions', async () => {
    const onReply = jest.fn()
    render(<DocumentReviewRail document={document} comments={comments} onReply={onReply} />)

    fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
    fireEvent.change(screen.getByPlaceholderText('Write a reply…'), {
      target: { value: 'Jane has the latest requirements.' },
    })
    fireEvent.change(screen.getByLabelText('Add reply context reference'), {
      target: { value: '@contacts:jane' },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Attach Jane Client' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }))

    await waitFor(() => expect(onReply).toHaveBeenCalledWith(
      'comment-open',
      'Jane has the latest requirements.',
      [expect.objectContaining({ type: 'contact', id: 'contact-1', label: 'Jane Client' })],
    ))
  })
})
