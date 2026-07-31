import { documentChatActions } from '@/lib/chat-context/adapters/document'
import type {
  ClientDocument,
  DocumentComment,
  DocumentSuggestion,
  DocumentTask,
} from '@/lib/client-documents/types'

function document(overrides: Partial<ClientDocument> = {}): ClientDocument {
  return {
    id: 'document-1',
    orgId: 'holder-org',
    title: 'Launch agreement',
    type: 'sales_proposal',
    templateId: 'sales-proposal',
    status: 'client_review',
    linked: { clientOrgId: 'client-org' },
    currentVersionId: 'version-2',
    latestPublishedVersionId: 'version-2',
    approvalMode: 'operational',
    clientPermissions: {
      canComment: true,
      canSuggest: true,
      canDirectEdit: false,
      canApprove: true,
    },
    assumptions: [],
    shareToken: 'share-token',
    shareEnabled: true,
    editShareEnabled: false,
    createdBy: 'admin-1',
    createdByType: 'user',
    updatedBy: 'admin-1',
    updatedByType: 'user',
    deleted: false,
    ...overrides,
  }
}

const comment = {
  id: 'comment-1',
  documentId: 'document-1',
  versionId: 'version-2',
  text: 'Confirm the launch date',
  userId: 'client-1',
  userName: 'Client',
  userRole: 'client',
  status: 'open',
  agentPickedUp: false,
} satisfies DocumentComment & { id: string }

const suggestion = {
  id: 'suggestion-1',
  documentId: 'document-1',
  versionId: 'version-2',
  blockId: 'scope',
  kind: 'replace_text',
  original: 'Old',
  proposed: 'New',
  status: 'open',
  createdBy: 'client-1',
} satisfies DocumentSuggestion & { id: string }

const task = {
  id: 'task-1',
  documentId: 'document-1',
  orgId: 'holder-org',
  title: 'Confirm scope',
  completed: false,
  createdBy: 'admin-1',
} satisfies DocumentTask & { id: string }

describe('document chat actions', () => {
  it('offers an eligible client operational approval and safe review controls', () => {
    const actions = documentChatActions({
      document: document(),
      user: { uid: 'client-1', role: 'client', orgId: 'client-org', orgIds: ['client-org'] },
      approvalPolicyAllows: true,
      openComments: [comment],
      openSuggestions: [suggestion],
      openTasks: [task],
    })

    expect(actions.document).toEqual([{
      id: 'approve-document:document-1:version-2',
      label: 'Approve published document',
      href: '/api/v1/client-documents/document-1/approve',
      method: 'POST',
      requiresApproval: true,
    }])
    expect(actions.comments.get('comment-1')).toEqual([expect.objectContaining({
      id: 'resolve-document-comment:document-1:comment-1',
      body: { resolved: true },
    })])
    expect(actions.tasks.get('task-1')).toEqual([expect.objectContaining({
      id: 'complete-document-task:document-1:task-1',
      body: { taskId: 'task-1', completed: true },
    })])
    expect(actions.suggestions.size).toBe(0)
  })

  it('respects client permission and organisation-policy gates', () => {
    const actions = documentChatActions({
      document: document({
        clientPermissions: {
          canComment: false,
          canSuggest: false,
          canDirectEdit: false,
          canApprove: false,
        },
      }),
      user: { uid: 'client-1', role: 'client', orgId: 'client-org', orgIds: ['client-org'] },
      approvalPolicyAllows: false,
      openComments: [comment],
      openSuggestions: [suggestion],
      openTasks: [],
    })

    expect(actions.document).toEqual([])
    expect(actions.comments.size).toBe(0)
    expect(actions.suggestions.size).toBe(0)
  })

  it('lets administrators publish only blocker-free documents with explicit multi-org acknowledgement', () => {
    const actions = documentChatActions({
      document: document({
        status: 'internal_review',
        linked: { clientOrgId: 'client-a', clientOrgIds: ['client-a', 'client-b'] },
        latestPublishedVersionId: undefined,
      }),
      user: { uid: 'admin-1', role: 'admin', orgId: 'holder-org' },
      approvalPolicyAllows: true,
      openComments: [],
      openSuggestions: [suggestion],
      openTasks: [],
    })

    expect(actions.document).toEqual([{
      id: 'publish-document:document-1:version-2',
      label: 'Publish to 2 client organisations',
      href: '/api/v1/client-documents/document-1/publish',
      method: 'POST',
      requiresApproval: true,
      body: { acknowledgeMultiOrgPublish: true },
    }])
    expect(actions.suggestions.get('suggestion-1')).toEqual([
      expect.objectContaining({ id: 'accept-document-suggestion:document-1:suggestion-1' }),
      expect.objectContaining({
        id: 'reject-document-suggestion:document-1:suggestion-1',
        destructive: true,
      }),
    ])

    expect(documentChatActions({
      document: document({
        status: 'internal_review',
        assumptions: [{
          id: 'assumption-1',
          text: 'Pricing is missing',
          severity: 'blocks_publish',
          status: 'open',
          createdBy: 'admin-1',
        }],
      }),
      user: { uid: 'admin-1', role: 'admin', orgId: 'holder-org' },
      approvalPolicyAllows: true,
      openComments: [],
      openSuggestions: [],
      openTasks: [],
    }).document).toEqual([])
  })

  it('keeps formal acceptance and provider signing as navigational input workflows', () => {
    const actions = documentChatActions({
      document: document({ approvalMode: 'formal_acceptance' }),
      user: { uid: 'client-1', role: 'client', orgId: 'client-org', orgIds: ['client-org'] },
      approvalPolicyAllows: true,
      openComments: [],
      openSuggestions: [],
      openTasks: [],
    })

    expect(actions.document).toEqual([])
  })
})
