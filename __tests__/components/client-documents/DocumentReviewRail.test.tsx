import { render, screen } from '@testing-library/react'

import { DocumentReviewRail } from '@/components/client-documents/DocumentReviewRail'
import type { ClientDocument, DocumentComment } from '@/lib/client-documents/types'

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

describe('DocumentReviewRail', () => {
  it('uses the shared segmented tabs for comment filters', () => {
    render(<DocumentReviewRail document={document} comments={comments} />)

    expect(screen.getByRole('tablist', { name: 'Document comment filters' })).toHaveClass('pib-tabs', 'pib-tabs-segmented')
    expect(screen.getByRole('tab', { name: /Open/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /All/ })).toBeInTheDocument()
  })
})
