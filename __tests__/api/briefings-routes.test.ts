export {}

import { NextRequest } from 'next/server'

const mockBuildBriefingFeed = jest.fn()
const mockCreateBriefingSnapshot = jest.fn()
const mockStateSet = jest.fn()
const mockProjectTaskAdd = jest.fn()
const mockActivityAdd = jest.fn()
const mockCollection = jest.fn()
const mockCanAccessOrg = jest.fn(() => true)
const mockGetProjectForUser = jest.fn()
const mockUser = { uid: 'admin-1', role: 'admin' as const, allowedOrgIds: ['org-1', 'pib-platform-owner'] }
const mockRoles: string[] = []

jest.mock('@/lib/api/auth', () => ({
  withAuth: (role: string, handler: (req: NextRequest, user: typeof mockUser, context?: unknown) => Promise<Response>) => {
    mockRoles.push(role)
    return async (req: NextRequest, context?: unknown) => handler(req, mockUser, context)
  },
}))

jest.mock('@/lib/briefing/feed', () => ({
  buildBriefingFeed: mockBuildBriefingFeed,
  createBriefingSnapshot: mockCreateBriefingSnapshot,
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: jest.fn(() => 'server-timestamp') },
  Timestamp: { fromMillis: jest.fn((ms: number) => ({ ms, toDate: () => new Date(ms) })) },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: mockCollection,
  },
}))

jest.mock('@/lib/api/platformAdmin', () => ({
  canAccessOrg: mockCanAccessOrg,
}))

jest.mock('@/lib/projects/access', () => ({
  getProjectForUser: mockGetProjectForUser,
}))

describe('briefing API routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRoles.length = 0
    mockCanAccessOrg.mockReturnValue(true)
    mockProjectTaskAdd.mockResolvedValue({ id: 'linked-task-1' })
    mockActivityAdd.mockResolvedValue({ id: 'crm-activity-1' })
    mockGetProjectForUser.mockResolvedValue({
      ok: true,
      doc: { data: () => ({ orgId: 'pib-platform-owner' }) },
    })
    mockCollection.mockImplementation((name: string) => {
      if (name === 'briefing_user_states') return { doc: jest.fn(() => ({ set: mockStateSet })) }
      if (name === 'activities') return { add: mockActivityAdd }
      if (name === 'projects') {
        return {
          doc: jest.fn(() => ({
            collection: jest.fn(() => ({ add: mockProjectTaskAdd })),
          })),
        }
      }
      return { doc: jest.fn(() => ({ set: mockStateSet })), add: jest.fn() }
    })
  })

  it('returns the authenticated briefing feed', async () => {
    mockBuildBriefingFeed.mockResolvedValue({ items: [], total: 0, pageSize: 40, hasMore: false, generatedAt: '2026-05-30T10:00:00.000Z', scope: { orgId: 'org-1' } })
    const { GET } = await import('@/app/api/v1/briefings/feed/route')

    const res = await GET(new NextRequest('http://localhost/api/v1/briefings/feed?orgId=org-1&priority=critical&sourceType=task&limit=25'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(mockRoles).toContain('client')
    expect(mockBuildBriefingFeed).toHaveBeenCalledWith(mockUser, {
      orgId: 'org-1',
      priority: 'critical',
      sourceType: 'task',
      limit: 25,
    })
  })

  it('saves a briefing snapshot report', async () => {
    mockCreateBriefingSnapshot.mockResolvedValue({ id: 'snapshot-1', orgId: 'org-1', title: 'Snapshot' })
    const { POST } = await import('@/app/api/v1/briefings/reports/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/briefings/reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'org-1', title: 'Snapshot', sourceType: 'comment', limit: 12 }),
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.snapshot.id).toBe('snapshot-1')
    expect(mockRoles).toContain('client')
    expect(mockCreateBriefingSnapshot).toHaveBeenCalledWith(mockUser, {
      orgId: 'org-1',
      title: 'Snapshot',
      priority: 'all',
      sourceType: 'comment',
      limit: 12,
    })
  })

  it('persists all supported internal briefing card action states for the tenant', async () => {
    const { POST } = await import('@/app/api/v1/briefings/items/[itemId]/state/route')
    const states = ['read', 'handled', 'rejected', 'approved', 'pending-review', 'follow-up-created']

    for (const action of states) {
      const res = await POST(new NextRequest('http://localhost/api/v1/briefings/items/task%3A1/state', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId: 'pib-platform-owner', action, note: `note ${action}` }),
      }), { params: Promise.resolve({ itemId: 'task%3A1' }) })
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.data).toMatchObject({ itemId: 'task:1', orgId: 'pib-platform-owner', status: action })
    }

    const snoozeAt = new Date(Date.now() + 86_400_000).toISOString()
    const snoozeRes = await POST(new NextRequest('http://localhost/api/v1/briefings/items/task%3A1/state', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'pib-platform-owner', action: 'snoozed', snoozedUntil: snoozeAt, note: 'Later' }),
    }), { params: Promise.resolve({ itemId: 'task%3A1' }) })
    const snoozeBody = await snoozeRes.json()

    expect(snoozeRes.status).toBe(200)
    expect(snoozeBody.data).toMatchObject({ itemId: 'task:1', orgId: 'pib-platform-owner', status: 'snoozed' })
    expect(mockRoles).toContain('client')
    expect(mockCollection).toHaveBeenCalledWith('briefing_user_states')
    expect(mockStateSet).toHaveBeenLastCalledWith(expect.objectContaining({
      itemId: 'task:1',
      userId: 'admin-1',
      orgId: 'pib-platform-owner',
      status: 'snoozed',
      note: 'Later',
    }), { merge: true })
  })

  it('requires tenant access before persisting briefing card state', async () => {
    mockCanAccessOrg.mockReturnValue(false)
    const { POST } = await import('@/app/api/v1/briefings/items/[itemId]/state/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/briefings/items/task%3A1/state', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'other-org', action: 'read' }),
    }), { params: Promise.resolve({ itemId: 'task%3A1' }) })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toContain('not have access')
    expect(mockStateSet).not.toHaveBeenCalled()
  })

  it('fails unsupported or externally gated briefing actions safely with clear copy and no side effects', async () => {
    const { POST } = await import('@/app/api/v1/briefings/items/[itemId]/state/route')

    const unsupported = await POST(new NextRequest('http://localhost/api/v1/briefings/items/task%3A1/state', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'pib-platform-owner', action: 'publish' }),
    }), { params: Promise.resolve({ itemId: 'task%3A1' }) })
    const unsupportedBody = await unsupported.json()

    expect(unsupported.status).toBe(400)
    expect(unsupportedBody.error).toContain('Unsupported briefing action')
    expect(unsupportedBody.error).toContain('No send, publish, spend, deploy, billing, or destructive action was performed')

    const gated = await POST(new NextRequest('http://localhost/api/v1/briefings/items/task%3A1/state', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: 'pib-platform-owner', action: 'approved', externalSideEffect: 'send' }),
    }), { params: Promise.resolve({ itemId: 'task%3A1' }) })
    const gatedBody = await gated.json()

    expect(gated.status).toBe(202)
    expect(gatedBody.data).toMatchObject({
      status: 'pending-review',
      approvalRequired: true,
      sideEffectPerformed: false,
    })
    expect(gatedBody.data.copy).toContain('Approval is still required before any external send')
    expect(mockStateSet).not.toHaveBeenCalled()
    expect(mockCollection).not.toHaveBeenCalledWith('social_posts')
    expect(mockCollection).not.toHaveBeenCalledWith('emails')
    expect(mockCollection).not.toHaveBeenCalledWith('ad_campaigns')
    expect(mockCollection).not.toHaveBeenCalledWith('deployments')
  })

  it('preserves approval-state copy without performing the approval side effect', async () => {
    const { POST } = await import('@/app/api/v1/briefings/items/[itemId]/state/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/briefings/items/approval%3A1/state', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orgId: 'pib-platform-owner',
        action: 'pending-review',
        approvalState: 'pending_approval',
        approvalCopy: 'Peet must approve the controlled send before outreach starts.',
      }),
    }), { params: Promise.resolve({ itemId: 'approval%3A1' }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toMatchObject({ status: 'pending-review', approvalState: 'pending_approval' })
    expect(mockStateSet).toHaveBeenCalledWith(expect.objectContaining({
      approvalState: 'pending_approval',
      approvalCopy: 'Peet must approve the controlled send before outreach starts.',
      sideEffectPerformed: false,
    }), { merge: true })
  })

  it('creates linked Projects/Kanban tasks with source ids, evidence rows, approval gate copy, and assign-agent routing', async () => {
    const { POST } = await import('@/app/api/v1/briefings/items/[itemId]/actions/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/briefings/items/agent-output%3Aout-1/actions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'assign-agent',
        orgId: 'pib-platform-owner',
        title: 'Theo: follow up evidence row',
        spec: 'Review the evidence and create the safe internal follow-up only.',
        assigneeAgentId: 'theo',
        reviewerAgentId: 'qa-release',
        context: {
          orgId: 'pib-platform-owner',
          projectId: 'project-1',
          taskId: 'source-task-1',
          documentId: 'doc-1',
          sourceDocumentSectionId: 'section-1',
          sourceEvidenceId: 'evidence-ledger-1',
          evidenceRowIds: ['ev-row-1', 'ev-row-2'],
          sourceSpecVersion: 'spec-v1',
          approvalGateTaskId: 'approval-task-1',
          riskLevel: 'medium',
          requiredCapability: 'write',
          expectedArtifacts: ['development commit', 'tests'],
        },
        source: { type: 'agent-output', id: 'out-1', url: '/admin/projects/project-1?taskId=source-task-1' },
        evidenceRows: [
          { id: 'ev-row-1', kind: 'commit', label: 'Development commit', value: 'abc123' },
          { id: 'ev-row-2', kind: 'link', label: 'Preview', value: 'Preview URL', href: '/admin/projects/project-1?taskId=source-task-1' },
        ],
        metadata: {
          softwareBuildEvidence: [
            { kind: 'commit', label: 'Fallback commit', value: 'fallback-sha' },
          ],
        },
      }),
    }), { params: Promise.resolve({ itemId: 'agent-output%3Aout-1' }) })
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data).toMatchObject({ taskId: 'linked-task-1', projectId: 'project-1', action: 'assign-agent' })
    expect(mockGetProjectForUser).toHaveBeenCalledWith('project-1', mockUser)
    expect(mockProjectTaskAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'pib-platform-owner',
      projectId: 'project-1',
      title: 'Theo: follow up evidence row',
      assigneeAgentId: 'theo',
      agentStatus: 'pending',
      reviewerAgentId: 'qa-release',
      dependsOn: ['approval-task-1'],
      internalOnly: true,
    }))
    const payload = mockProjectTaskAdd.mock.calls[0][0]
    expect(payload.attachments).toEqual([expect.objectContaining({ name: 'Preview', url: '/admin/projects/project-1?taskId=source-task-1' })])
    expect(payload.agentInput.context).toMatchObject({
      orgId: 'pib-platform-owner',
      sourceProjectId: 'project-1',
      sourceTaskId: 'source-task-1',
      sourceDocumentId: 'doc-1',
      sourceDocumentSectionId: 'section-1',
      sourceEvidenceId: 'evidence-ledger-1',
      evidenceRowIds: ['ev-row-1', 'ev-row-2'],
      sourceSpecVersion: 'spec-v1',
      approvalGateTaskId: 'approval-task-1',
      sourceBriefingId: 'agent-output:out-1',
      sourceBriefingSourceType: 'agent-output',
      sourceBriefingSourceId: 'out-1',
      riskLevel: 'medium',
      requiredCapability: 'write',
      expectedArtifacts: ['development commit', 'tests'],
      evidenceRows: [
        { id: 'ev-row-1', kind: 'commit', label: 'Development commit', value: 'abc123' },
        { id: 'ev-row-2', kind: 'link', label: 'Preview', value: 'Preview URL', href: '/admin/projects/project-1?taskId=source-task-1' },
      ],
    })
    expect(payload.agentInput.context.approvalGateCopy).toContain('approval-task-1')
    expect(payload.agentInput.context.approvalGateCopy).toContain('external send')
    expect(mockActivityAdd).not.toHaveBeenCalled()
  })

  it('rejects external briefing action requests without creating durable records', async () => {
    const { POST } = await import('@/app/api/v1/briefings/items/[itemId]/actions/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/briefings/items/social%3Apost-1/actions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'publish',
        orgId: 'pib-platform-owner',
        context: { projectId: 'project-1', taskId: 'task-1' },
      }),
    }), { params: Promise.resolve({ itemId: 'social%3Apost-1' }) })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain('Approval is still required before publish')
    expect(body.error).toContain('No send, publish, spend, deploy, billing, secret/config, or destructive action was performed')
    expect(mockProjectTaskAdd).not.toHaveBeenCalled()
    expect(mockActivityAdd).not.toHaveBeenCalled()
    expect(mockCollection).not.toHaveBeenCalledWith('social_posts')
    expect(mockCollection).not.toHaveBeenCalledWith('emails')
  })

  it('requires tenant access before creating linked briefing actions', async () => {
    mockCanAccessOrg.mockReturnValue(false)
    const { POST } = await import('@/app/api/v1/briefings/items/[itemId]/actions/route')

    const res = await POST(new NextRequest('http://localhost/api/v1/briefings/items/contact%3Acontact-1/actions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'create-crm-activity',
        orgId: 'other-org',
        contactId: 'contact-1',
        summary: 'Internal note only.',
        crmActivityInternalOnly: true,
      }),
    }), { params: Promise.resolve({ itemId: 'contact%3Acontact-1' }) })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toContain('not have access')
    expect(mockActivityAdd).not.toHaveBeenCalled()
    expect(mockProjectTaskAdd).not.toHaveBeenCalled()
  })

  it('only creates internal CRM activity records when explicitly marked safe', async () => {
    const { POST } = await import('@/app/api/v1/briefings/items/[itemId]/actions/route')

    const blocked = await POST(new NextRequest('http://localhost/api/v1/briefings/items/contact%3Acontact-1/actions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'create-crm-activity',
        orgId: 'pib-platform-owner',
        contactId: 'contact-1',
        summary: 'Internal note only.',
      }),
    }), { params: Promise.resolve({ itemId: 'contact%3Acontact-1' }) })
    expect(blocked.status).toBe(400)
    expect(mockActivityAdd).not.toHaveBeenCalled()

    const safe = await POST(new NextRequest('http://localhost/api/v1/briefings/items/contact%3Acontact-1/actions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'create-crm-activity',
        orgId: 'pib-platform-owner',
        contactId: 'contact-1',
        dealId: 'deal-1',
        summary: 'Internal note only.',
        crmActivityInternalOnly: true,
        source: { type: 'contact', id: 'contact-1' },
      }),
    }), { params: Promise.resolve({ itemId: 'contact%3Acontact-1' }) })

    expect(safe.status).toBe(201)
    expect(mockActivityAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'pib-platform-owner',
      contactId: 'contact-1',
      dealId: 'deal-1',
      type: 'note',
      summary: 'Internal note only.',
      internalOnly: true,
      metadata: expect.objectContaining({
        source: 'briefings-control-desk',
        sourceBriefingId: 'contact:contact-1',
        sourceBriefingSourceType: 'contact',
        sourceBriefingSourceId: 'contact-1',
        internalOnly: true,
      }),
    }))
    expect(mockProjectTaskAdd).not.toHaveBeenCalled()
  })
})
