import {
  normalizeWorkspaceConnectionInput,
  buildWorkspaceConnectionUpdate,
} from '@/lib/workspace-os/connections'
import {
  normalizeWorkspaceArtifactInput,
  canReadWorkspaceArtifact,
  workspaceArtifactMatchesLookup,
} from '@/lib/workspace-os/artifacts'
import {
  buildWorkspaceBrokerJobInput,
  evaluateWorkspaceBrokerApproval,
  detectWorkspaceAclAlignment,
  canExecuteWorkspaceBrokerJob,
} from '@/lib/workspace-os/broker'
import {
  normalizeWorkspaceFolderInput,
  canReadWorkspaceFolder,
} from '@/lib/workspace-folders/model'

describe('workspace connection registry models', () => {
  it('normalizes approved Google Workspace connections without storing raw secrets', () => {
    const connection = normalizeWorkspaceConnectionInput({
      connectionKey: ' Parent Drive ',
      displayName: 'Parent Drive Automation',
      connectionType: 'service_account',
      status: 'active',
      ownerAgentId: 'theo',
      serviceAccountEmail: 'workspace-broker@pib.iam.gserviceaccount.com',
      scopes: [{ scope: 'https://www.googleapis.com/auth/drive.file', classification: 'sensitive', approved: true, approvedBy: 'peet', approvalGateTaskId: 'approval-1' }],
      capabilities: { driveRead: true, driveWrite: true, docsWrite: true },
      credentialRef: { secretName: 'workspace/broker', tokenStorePath: '/secure/token.json' },
      automationIdentity: 'service_account',
      riskLevel: 'medium',
    }, 'org-1')

    expect(connection).toMatchObject({
      orgId: 'org-1',
      connectionKey: 'parent-drive',
      displayName: 'Parent Drive Automation',
      provider: 'google_workspace',
      connectionType: 'service_account',
      status: 'active',
      capabilities: { driveRead: true, driveWrite: true, driveShare: false, driveDelete: false, docsWrite: true },
      credentialRef: { secretName: 'workspace/broker', envVarName: null, tokenStorePath: '/secure/token.json', keyPrefix: null },
      scopes: [expect.objectContaining({ approved: true, classification: 'sensitive' })],
      deleted: false,
    })
  })

  it('rejects raw credential material in connection payloads', () => {
    expect(() => normalizeWorkspaceConnectionInput({ displayName: 'Bad', clientSecret: 'secret' }, 'org-1')).toThrow('raw secrets are not allowed')
    expect(() => normalizeWorkspaceConnectionInput({ displayName: 'Bad', credentialRef: { privateKey: '-----BEGIN PRIVATE KEY-----' } }, 'org-1')).toThrow('raw secrets are not allowed')
    expect(() => buildWorkspaceConnectionUpdate({ orgId: 'org-2' })).toThrow('orgId cannot be changed')
  })

  it('records the full safe registry envelope for tenant-scoped connections', () => {
    const connection = normalizeWorkspaceConnectionInput({
      displayName: 'Client Drive link',
      owner: { type: 'agent', id: 'theo' },
      visibility: 'admin_agents',
      resourceType: 'project',
      resourceId: 'project-1',
      projectId: 'project-1',
      taskId: 'task-1',
      capabilityScopes: ['drive.read', 'docs.write'],
      audit: { approvalStatus: 'approved', riskLevel: 'medium', lastReviewedBy: 'peet' },
      safeMetadata: { note: 'metadata only', retryCount: 1, flags: ['internal'] },
    }, 'org-1')

    expect(connection).toMatchObject({
      orgId: 'org-1',
      provider: 'google_workspace',
      visibility: 'admin_agents',
      owner: { type: 'agent', id: 'theo' },
      resourceType: 'project',
      resourceId: 'project-1',
      projectId: 'project-1',
      taskId: 'task-1',
      capabilityScopes: ['drive.read', 'docs.write'],
      audit: expect.objectContaining({ approvalStatus: 'approved', riskLevel: 'medium', lastReviewedBy: 'peet' }),
      safeMetadata: { note: 'metadata only', retryCount: 1, flags: ['internal'] },
    })
  })
})

describe('workspace artifact registry models', () => {
  it('normalizes Drive/Docs/Sheets artifact records with provenance and permissions', () => {
    const artifact = normalizeWorkspaceArtifactInput({
      artifactKey: ' Phase 2 Plan ',
      title: 'Phase 2 plan',
      artifactType: 'google_doc',
      googleUrl: 'https://docs.google.com/document/d/doc-123/edit',
      workspaceFolderId: 'folder-1',
      projectId: 'project-1',
      taskId: 'task-1',
      sourceDocumentId: 'source-doc',
      sourceSpecVersion: 'v1',
      visibility: 'admin_agents',
      lifecycleStatus: 'internal_review',
      permissions: { anyoneWithLink: false, externalShared: false, aclAlignmentStatus: 'aligned' },
    }, 'org-1')

    expect(artifact).toMatchObject({
      orgId: 'org-1',
      artifactKey: 'phase-2-plan',
      title: 'Phase 2 plan',
      artifactType: 'google_doc',
      google: expect.objectContaining({ fileId: 'doc-123', url: 'https://docs.google.com/document/d/doc-123/edit' }),
      workspaceFolderId: 'folder-1',
      projectId: 'project-1',
      taskId: 'task-1',
      sourceDocumentId: 'source-doc',
      sourceSpecVersion: 'v1',
      visibility: 'admin_agents',
      lifecycleStatus: 'internal_review',
      permissions: expect.objectContaining({ aclAlignmentStatus: 'aligned' }),
      deleted: false,
    })
  })

  it('filters artifact visibility for clients and agents', () => {
    const internal = normalizeWorkspaceArtifactInput({ title: 'Internal', visibility: 'admin_agents' }, 'org-1')
    const clientVisible = normalizeWorkspaceArtifactInput({ title: 'Client', visibility: 'admin_agents_clients', lifecycleStatus: 'client_visible' }, 'org-1')

    expect(canReadWorkspaceArtifact(internal, { uid: 'agent:theo', role: 'ai', agentId: 'theo' })).toBe(true)
    expect(canReadWorkspaceArtifact(internal, { uid: 'client', role: 'client', orgId: 'org-1' })).toBe(false)
    expect(canReadWorkspaceArtifact(clientVisible, { uid: 'client', role: 'client', orgId: 'org-1' })).toBe(true)
    expect(workspaceArtifactMatchesLookup(internal, { visibility: 'admin_agents', projectId: null })).toBe(true)
  })

  it('rejects unsafe Google artifact URLs', () => {
    expect(() => normalizeWorkspaceArtifactInput({ title: 'Bad', googleUrl: 'javascript:alert(1)' }, 'org-1')).toThrow('googleUrl must be an http(s) URL')
    expect(() => normalizeWorkspaceArtifactInput({ title: 'Bad', safeMetadata: { refreshToken: 'raw' } }, 'org-1')).toThrow('raw secrets are not allowed')
  })

  it('records provider, owner, capabilities, audit state, and safe metadata for artifacts', () => {
    const artifact = normalizeWorkspaceArtifactInput({
      title: 'Internal proof',
      owner: { type: 'agent', id: 'theo' },
      provider: 'google_workspace',
      capabilityScopes: ['drive.read'],
      safeMetadata: { source: 'broker', pages: 3 },
      audit: { approvalStatus: 'pending', auditStatus: 'needs_review', lastReviewedBy: 'quinn' },
    }, 'org-1')

    expect(artifact).toMatchObject({
      orgId: 'org-1',
      provider: 'google_workspace',
      owner: { type: 'agent', id: 'theo' },
      capabilityScopes: ['drive.read'],
      audit: expect.objectContaining({ approvalStatus: 'pending', auditStatus: 'needs_review', lastReviewedBy: 'quinn' }),
      safeMetadata: { source: 'broker', pages: 3 },
    })
  })
})

describe('workspace folder registry models', () => {
  it('records owner, provider, resource links, capability scopes, audit state, and safe metadata for folders', () => {
    const folder = normalizeWorkspaceFolderInput({
      name: 'Client assets',
      resourceType: 'project',
      resourceId: 'project-1',
      projectId: 'project-1',
      taskId: 'task-1',
      clientDocumentId: 'doc-1',
      connectionId: 'conn-1',
      provider: 'google_workspace',
      owner: { type: 'agent', id: 'theo' },
      capabilityScopes: ['drive.read', 'drive.write'],
      visibility: 'admin_agents',
      audit: { approvalStatus: 'approved', auditStatus: 'aligned', lastReviewedBy: 'peet' },
      safeMetadata: { source: 'provisioning' },
    }, 'org-1')

    expect(folder).toMatchObject({
      orgId: 'org-1',
      provider: 'google_workspace',
      connectionId: 'conn-1',
      owner: { type: 'agent', id: 'theo' },
      resourceType: 'project',
      resourceId: 'project-1',
      projectId: 'project-1',
      taskId: 'task-1',
      clientDocumentId: 'doc-1',
      capabilityScopes: ['drive.read', 'drive.write'],
      audit: expect.objectContaining({ approvalStatus: 'approved', auditStatus: 'aligned', lastReviewedBy: 'peet' }),
      safeMetadata: { source: 'provisioning' },
    })
  })

  it('keeps folder reads tenant-isolated and agent capability filtered', () => {
    const folder = normalizeWorkspaceFolderInput({ name: 'Theo only', visibility: 'admin_agents', permissions: { allowedAgentIds: ['theo'] } }, 'org-1')

    expect(canReadWorkspaceFolder(folder, { uid: 'agent:theo', role: 'ai', agentId: 'theo' })).toBe(true)
    expect(canReadWorkspaceFolder(folder, { uid: 'agent:maya', role: 'ai', agentId: 'maya' })).toBe(false)
    expect(canReadWorkspaceFolder(folder, { uid: 'client', role: 'client', orgId: 'org-2' })).toBe(false)
    expect(() => normalizeWorkspaceFolderInput({ name: 'Bad', safeMetadata: { accessToken: 'raw' } }, 'org-1')).toThrow('raw secrets are not allowed')
  })
})

describe('workspace broker approval envelope', () => {
  it('maps operations to safe capabilities and approval states', () => {
    expect(evaluateWorkspaceBrokerApproval({ operation: 'link_existing', visibility: 'admin_agents' })).toMatchObject({ requiredCapability: 'draft', riskLevel: 'low', approvalRequired: false })
    expect(evaluateWorkspaceBrokerApproval({ operation: 'create_doc', visibility: 'admin_agents_clients' })).toMatchObject({ requiredCapability: 'write', riskLevel: 'medium', approvalRequired: true })
    expect(evaluateWorkspaceBrokerApproval({ operation: 'request_share', visibility: 'admin_agents_clients' })).toMatchObject({ requiredCapability: 'publish', riskLevel: 'high', approvalRequired: true })
    expect(evaluateWorkspaceBrokerApproval({ operation: 'request_delete' })).toMatchObject({ requiredCapability: 'delete', riskLevel: 'high', approvalRequired: true })
  })

  it('creates broker jobs with requester, target, approval, idempotency, result, error, and timestamp audit fields', () => {
    const job = buildWorkspaceBrokerJobInput({
      operation: 'create_sheet',
      orgId: 'org-1',
      agentId: 'theo',
      requestedBy: 'agent:theo',
      createdByType: 'agent',
      approvalGateTaskId: 'task-approval-1',
      approvalStatus: 'approved',
      approvalTrusted: true,
      idempotencyKey: 'idem-1',
      now: '2026-06-05T12:00:00.000Z',
      input: { title: 'Budget', projectId: 'project-1', folderId: 'folder-1', visibility: 'admin_agents_clients' },
    })

    expect(job).toMatchObject({
      orgId: 'org-1',
      operation: 'create_sheet',
      status: 'queued',
      requester: { id: 'agent:theo', type: 'agent', role: 'agent', agentId: 'theo' },
      requestedBy: 'agent:theo',
      requestedCapability: 'write',
      requiredCapability: 'write',
      riskLevel: 'medium',
      approvalRequired: true,
      approvalSatisfied: true,
      approvalEvidence: { gateTaskId: 'task-approval-1', status: 'approved' },
      targetResource: { projectId: 'project-1', folderId: 'folder-1', title: 'Budget' },
      output: { googleMutationPerformed: false, artifactIds: [], artifactUrls: [], resultArtifactIds: [], resultArtifactUrls: [] },
      resultArtifactIds: [],
      resultArtifactUrls: [],
      errors: [],
      error: null,
      idempotencyKey: 'idem-1',
      requestedAt: '2026-06-05T12:00:00.000Z',
      updatedAt: '2026-06-05T12:00:00.000Z',
      completedAt: null,
    })
  })

  it('blocks gated broker side effects from execution until approval evidence is satisfied', () => {
    const awaiting = buildWorkspaceBrokerJobInput({
      operation: 'request_share',
      orgId: 'org-1',
      requestedBy: 'admin-1',
      input: { artifactId: 'artifact-1', visibility: 'admin_agents_clients' },
    })
    const approved = buildWorkspaceBrokerJobInput({
      operation: 'request_share',
      orgId: 'org-1',
      requestedBy: 'admin-1',
      approvalGateTaskId: 'task-approval-1',
      approvalStatus: 'approved',
      input: { artifactId: 'artifact-1', visibility: 'admin_agents_clients' },
    })

    expect(canExecuteWorkspaceBrokerJob(awaiting)).toMatchObject({ ok: false, reason: 'approval_required' })
    expect(canExecuteWorkspaceBrokerJob({ ...approved, status: 'running' })).toMatchObject({ ok: true })
  })

  it('detects Google ACLs that are broader than PiB visibility', () => {
    expect(detectWorkspaceAclAlignment({ visibility: 'admin_agents', anyoneWithLink: true, externalShared: false })).toBe('broader_than_pib')
    expect(detectWorkspaceAclAlignment({ visibility: 'admin_agents_clients', anyoneWithLink: false, externalShared: false })).toBe('aligned')
  })
})
