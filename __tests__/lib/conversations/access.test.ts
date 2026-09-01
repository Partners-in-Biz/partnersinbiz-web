import {
  authorizeConversationProject,
  canAccessConversation,
  canManageConversationAccess,
  canReplyConversation,
  conversationVisibilityLabel,
  publicConversationMessageView,
  publicConversationView,
} from '@/lib/conversations/access'
import type { ApiUser } from '@/lib/api/types'
import type { Conversation } from '@/lib/conversations/types'

function conversation(shareMode: 'private' | 'shared' | 'org'): Conversation {
  return {
    id: 'conv-1',
    orgId: 'org-1',
    title: 'Workspace chat',
    scope: 'workspace',
    scopeRefId: 'acme',
    startedBy: 'owner-1',
    participantUids: ['owner-1', ...(shareMode === 'shared' ? ['member-1'] : [])],
    participantAgentIds: ['pip'],
    participants: [],
    status: 'active',
    archived: false,
    messageCount: 0,
    createdAt: '2026-07-09T00:00:00Z',
    updatedAt: '2026-07-09T00:00:00Z',
    workspaceContext: {
      workspaceId: 'acme',
      orgId: 'org-1',
      orgSlug: 'acme',
      orgName: 'Acme',
      agentDomain: 'acme',
      vpsPath: '/var/lib/hermes/Cowork/partners/Acme',
      localPath: '/Users/test/Cowork/partners/Acme',
      agentDomainPath: '/var/lib/hermes/cowork-wiki/agents/acme',
      localAgentDomainPath: '/Users/test/Cowork/Cowork/agents/acme',
      sourceOfTruth: 'vps',
      runtimeTarget: 'vps',
      runtimeLabel: 'VPS',
      shareMode,
      ownerUserId: 'owner-1',
      companyId: null,
      contactIds: [],
    },
  }
}

const owner = { uid: 'owner-1', role: 'client', orgId: 'org-1' } as ApiUser
const member = { uid: 'member-1', role: 'client', orgId: 'org-1' } as ApiUser
const outsider = { uid: 'outsider-1', role: 'client', orgId: 'org-2' } as ApiUser

describe('Workspace conversation access', () => {
  it('keeps private conversations owner/participant-only', () => {
    expect(canAccessConversation(owner, conversation('private'))).toBe(true)
    expect(canAccessConversation(member, conversation('private'))).toBe(false)
  })

  it('allows explicitly selected participants into shared conversations', () => {
    expect(canAccessConversation(member, conversation('shared'))).toBe(true)
    expect(canAccessConversation(outsider, conversation('shared'))).toBe(false)
  })

  it('allows authenticated organisation members into org-visible conversations', () => {
    expect(canAccessConversation(member, conversation('org'))).toBe(true)
    expect(canAccessConversation(outsider, conversation('org'))).toBe(false)
  })

  it('allows PiB staff named on a client-org thread without joining that org', () => {
    const stean = {
      uid: 'stean',
      role: 'client',
      orgId: 'pib-platform-owner',
      activeOrgId: 'pib-platform-owner',
      orgIds: ['pib-platform-owner'],
    } as ApiUser
    const thread = conversation('private')
    thread.orgId = 'wS5pgwa6c9WbPocf4w0w'
    thread.participantUids.push('stean')
    expect(canAccessConversation(stean, thread)).toBe(true)
    expect(canReplyConversation(stean, thread)).toBe(true)
    expect(canAccessConversation(outsider, thread)).toBe(false)
  })

  it('allows every authenticated organisation member to reply in organisation conversations', () => {
    expect(conversation('org').participantUids).not.toContain(member.uid)
    expect(canReplyConversation(member, conversation('org'))).toBe(true)
    expect(canReplyConversation(outsider, conversation('org'))).toBe(false)
  })

  it('requires administrators and AI callers to be explicit participants in private conversations', () => {
    const restrictedAdmin = { uid: 'admin-1', role: 'admin', allowedOrgIds: ['org-2'] } as ApiUser
    const scopedAdmin = { uid: 'admin-2', role: 'admin', allowedOrgIds: ['org-1'] } as ApiUser
    const participatingAdmin = { uid: 'admin-3', role: 'admin', allowedOrgIds: ['org-1'] } as ApiUser
    const pip = { uid: 'agent-user', role: 'ai', agentId: 'pip', orgId: 'org-1' } as ApiUser
    const crossOrgPip = { uid: 'agent-user', role: 'ai', agentId: 'pip', orgId: 'org-2' } as ApiUser
    const maya = { uid: 'agent-user-2', role: 'ai', agentId: 'maya', orgId: 'org-1' } as ApiUser
    expect(canAccessConversation(restrictedAdmin, conversation('private'))).toBe(false)
    const privateConversation = conversation('private')
    privateConversation.participantUids.push('admin-3')
    expect(canAccessConversation(scopedAdmin, privateConversation)).toBe(false)
    expect(canAccessConversation(participatingAdmin, privateConversation)).toBe(true)
    expect(canAccessConversation(pip, conversation('private'))).toBe(true)
    expect(canAccessConversation(crossOrgPip, conversation('private'))).toBe(false)
    expect(canAccessConversation(maya, conversation('org'))).toBe(false)
  })

  it('redacts server and local filesystem paths from public conversation views', () => {
    const privateConversation = conversation('private')
    if (privateConversation.workspaceContext) {
      privateConversation.workspaceContext.vpsWorkingPath = '/var/lib/hermes/Cowork/partners/Acme/projects/project-1'
      privateConversation.workspaceContext.localWorkingPath = '~/Cowork/partners/Acme/projects/project-1'
    }
    privateConversation.participants = [{ kind: 'user', uid: 'owner-1', role: 'client', email: 'owner@example.com' }]
    const publicView = publicConversationView(privateConversation)
    expect(publicView.workspaceContext).toEqual(expect.objectContaining({ workspaceId: 'acme', runtimeLabel: 'VPS' }))
    expect(publicView.workspaceContext).not.toHaveProperty('vpsPath')
    expect(publicView.workspaceContext).not.toHaveProperty('localPath')
    expect(publicView.workspaceContext).not.toHaveProperty('vpsWorkingPath')
    expect(publicView.workspaceContext).not.toHaveProperty('localWorkingPath')
    expect(publicView.workspaceContext).not.toHaveProperty('agentDomainPath')
    expect(publicView.workspaceContext).not.toHaveProperty('localAgentDomainPath')
    expect(publicView.participants[0]).not.toHaveProperty('email')
  })

  it('exposes only the requesting member read state', () => {
    const privateConversation = conversation('shared')
    privateConversation.unreadCounts = { 'owner-1': 2, 'member-1': 7 }
    privateConversation.readStateByUser = {
      'owner-1': { lastReadMessageId: 'message-owner', lastReadMessageCount: 0 },
      'member-1': { lastReadMessageId: 'message-member', lastReadMessageCount: 0 },
    }
    const publicView = publicConversationView(privateConversation, 'member-1')
    expect(publicView.unreadCount).toBe(7)
    expect(publicView.lastReadMessageId).toBe('message-member')
    expect(publicView).not.toHaveProperty('unreadCounts')
    expect(publicView).not.toHaveProperty('readStateByUser')
    expect(JSON.stringify(publicView)).not.toContain('message-owner')
  })

  it('derives unread state for an org-visible member who is not an explicit participant', () => {
    const orgConversation = conversation('org')
    orgConversation.messageCount = 12
    orgConversation.readStateByUser = {
      'member-1': { lastReadMessageId: 'message-8', lastReadMessageCount: 8 },
    }
    expect(publicConversationView(orgConversation, 'member-1').unreadCount).toBe(4)
  })

  it('treats all existing org-visible messages as unread for org members without prior read state', () => {
    const orgConversation = conversation('org')
    orgConversation.messageCount = 12
    expect(publicConversationView(orgConversation, 'member-1').unreadCount).toBe(12)
  })

  it('replaces persisted attachment bearer URLs and storage paths in public message views', () => {
    const publicMessage = publicConversationMessageView({
      id: 'msg-1',
      conversationId: 'conv-1',
      role: 'user',
      content: '',
      authorKind: 'user',
      authorId: 'owner-1',
      authorDisplayName: 'Owner',
      runId: 'browser-run-id',
      runDocId: 'internal-ledger-id',
      dispatchAgentId: 'pip',
      events: [{ type: 'tool', output: '/var/lib/hermes/private' }],
      toolName: 'terminal',
      attachments: [{
        id: 'attachment-1',
        name: 'brief.pdf',
        contentType: 'application/pdf',
        sizeBytes: 123,
        url: 'https://storage.example/token-secret',
        storagePath: 'conversation-attachments/org-1/conv-1/private.pdf',
      }],
    })
    expect(publicMessage.attachments).toEqual([expect.objectContaining({
      id: 'attachment-1',
      url: '/api/v1/conversations/conv-1/attachments/attachment-1',
    })])
    expect(publicMessage.attachments?.[0]).not.toHaveProperty('storagePath')
    expect(publicMessage.runId).toBe('browser-run-id')
    expect(publicMessage).not.toHaveProperty('runDocId')
    expect(publicMessage.dispatchAgentId).toBe('pip')
    expect(publicMessage).not.toHaveProperty('events')
    expect(publicMessage).not.toHaveProperty('toolName')
  })

  it('exposes sanitized thinking traces without raw tool events', () => {
    const publicMessage = publicConversationMessageView({
      id: 'msg-2',
      conversationId: 'conv-1',
      role: 'assistant',
      content: 'Done.',
      authorKind: 'agent',
      authorId: 'pip',
      authorDisplayName: 'Pip',
      events: [{ type: 'tool', output: '/var/lib/hermes/private' }],
      thinking: {
        summary: 'Checked project status via API.',
        steps: [{ kind: 'tool', label: 'terminal', status: 'completed' }],
        toolCount: 1,
        durationMs: 4200,
      },
    })
    expect(publicMessage.thinking).toEqual({
      summary: 'Checked project status via API.',
      steps: [{ kind: 'tool', label: 'terminal', status: 'completed' }],
      toolCount: 1,
      durationMs: 4200,
    })
    expect(publicMessage).not.toHaveProperty('events')
  })

  it('keeps open_context uiActions so email draft review buttons reach the client', () => {
    const publicMessage = publicConversationMessageView({
      id: 'msg-email',
      conversationId: 'conv-1',
      role: 'assistant',
      content: 'Draft ready. Use Review email draft in the side panel.',
      authorKind: 'agent',
      authorId: 'pip',
      authorDisplayName: 'Pip',
      uiActions: [{
        id: 'open-email-draft:draft-1',
        type: 'open_context',
        label: 'Review email draft',
        variant: 'primary',
        payload: { kind: 'email', id: 'draft-1', label: 'Proposal' },
      }],
      contextRefs: [{
        type: 'email',
        id: 'draft-1',
        label: 'Proposal',
        origin: 'manual',
      }],
    })
    expect(publicMessage.uiActions).toEqual([expect.objectContaining({
      id: 'open-email-draft:draft-1',
      type: 'open_context',
      label: 'Review email draft',
      payload: expect.objectContaining({ kind: 'email', id: 'draft-1' }),
    })])
    expect(publicMessage.ui_actions).toEqual(publicMessage.uiActions)
    expect(publicMessage.contextRefs).toEqual([expect.objectContaining({ type: 'email', id: 'draft-1' })])
  })

  it('limits access management to the canonical owner or a scoped administrator', () => {
    const scopedAdmin = { uid: 'admin-2', role: 'admin', allowedOrgIds: ['org-1'] } as ApiUser
    const restrictedAdmin = { uid: 'admin-1', role: 'admin', allowedOrgIds: ['org-2'] } as ApiUser
    expect(canManageConversationAccess(owner, conversation('private'))).toBe(true)
    expect(canManageConversationAccess(member, conversation('shared'))).toBe(false)
    expect(canManageConversationAccess(scopedAdmin, conversation('private'))).toBe(true)
    expect(canManageConversationAccess(restrictedAdmin, conversation('private'))).toBe(false)
  })

  it('requires explicit participation for replies even when an administrator can read', () => {
    const scopedAdmin = { uid: 'admin-2', role: 'admin', allowedOrgIds: ['org-1'] } as ApiUser
    const participatingAdmin = { uid: 'admin-3', role: 'admin', allowedOrgIds: ['org-1'] } as ApiUser
    const privateConversation = conversation('private')
    privateConversation.participantUids.push('admin-3')
    expect(canReplyConversation(scopedAdmin, privateConversation)).toBe(false)
    expect(canReplyConversation(participatingAdmin, privateConversation)).toBe(true)
  })

  it('provides stable visibility labels', () => {
    expect(conversationVisibilityLabel(conversation('private'))).toBe('Private')
    expect(conversationVisibilityLabel(conversation('shared'))).toBe('Shared')
    expect(conversationVisibilityLabel(conversation('org'))).toBe('Organisation')
  })

  it('fails closed when a project conversation is no longer linked to its organisation', async () => {
    const projectConversation = conversation('org')
    projectConversation.scope = 'project'
    projectConversation.scopeRefId = 'project-1'
    const getProject = jest.fn().mockResolvedValue({
      ok: true,
      doc: { data: () => ({ orgId: 'org-2' }) },
      projectAccess: { role: 'viewer' },
    })
    const linked = jest.fn().mockResolvedValue(false)

    await expect(authorizeConversationProject(owner, projectConversation, {
      getProjectForUser: getProject,
      projectLinkedToOrganization: linked,
    })).resolves.toEqual({ ok: false, status: 403, error: 'Project is outside this organisation' })
    expect(getProject).toHaveBeenCalledWith('project-1', owner, 'org-1')
    expect(linked).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1', orgId: 'org-1',
    }))
  })

  it('treats the active project linked inside chat as a mutable project authorization boundary', async () => {
    const projectConversation = conversation('org')
    projectConversation.contextRefs = [
      { type: 'company', id: 'company-1', orgId: 'org-1', label: 'Acme', origin: 'manual' },
      { type: 'project', id: 'project-context-1', orgId: 'org-1', label: 'Website', origin: 'manual' },
    ]
    const getProject = jest.fn().mockResolvedValue({
      ok: true,
      doc: { data: () => ({ clientOrgIds: ['org-1'] }) },
      projectAccess: { role: 'contributor' },
    })
    const linked = jest.fn().mockResolvedValue(true)

    await expect(authorizeConversationProject(owner, projectConversation, {
      getProjectForUser: getProject,
      projectLinkedToOrganization: linked,
    })).resolves.toEqual({ ok: true, projectId: 'project-context-1' })
    expect(getProject).toHaveBeenCalledWith('project-context-1', owner, 'org-1')
    expect(linked).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-context-1', orgId: 'org-1',
    }))
  })

  it('retries project auth for PiB staff on a client-org thread via the platform org', async () => {
    const stean = {
      uid: 'stean',
      role: 'client',
      orgId: 'pib-platform-owner',
      activeOrgId: 'pib-platform-owner',
      orgIds: ['pib-platform-owner'],
    } as ApiUser
    const projectConversation = conversation('private')
    projectConversation.orgId = 'wS5pgwa6c9WbPocf4w0w'
    projectConversation.participantUids.push('stean')
    projectConversation.scope = 'project'
    projectConversation.scopeRefId = 'project-1'

    const getProject = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 403, error: 'Forbidden' })
      .mockResolvedValueOnce({
        ok: true,
        doc: { data: () => ({ clientOrgIds: ['wS5pgwa6c9WbPocf4w0w'] }) },
        projectAccess: { role: 'contributor' },
      })
    const linked = jest.fn().mockResolvedValue(true)

    await expect(authorizeConversationProject(stean, projectConversation, {
      getProjectForUser: getProject,
      projectLinkedToOrganization: linked,
    })).resolves.toEqual({ ok: true, projectId: 'project-1' })

    expect(getProject).toHaveBeenNthCalledWith(1, 'project-1', stean, 'wS5pgwa6c9WbPocf4w0w')
    expect(getProject).toHaveBeenNthCalledWith(2, 'project-1', stean, 'pib-platform-owner')
    expect(linked).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      orgId: 'wS5pgwa6c9WbPocf4w0w',
    }))
  })
})
