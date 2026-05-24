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
} from '@/lib/workspace-os/broker'

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
  })
})

describe('workspace broker approval envelope', () => {
  it('maps operations to safe capabilities and approval states', () => {
    expect(evaluateWorkspaceBrokerApproval({ operation: 'link_existing', visibility: 'admin_agents' })).toMatchObject({ requiredCapability: 'draft', riskLevel: 'low', approvalRequired: false })
    expect(evaluateWorkspaceBrokerApproval({ operation: 'create_doc', visibility: 'admin_agents_clients' })).toMatchObject({ requiredCapability: 'write', riskLevel: 'medium', approvalRequired: true })
    expect(evaluateWorkspaceBrokerApproval({ operation: 'request_share', visibility: 'admin_agents_clients' })).toMatchObject({ requiredCapability: 'publish', riskLevel: 'high', approvalRequired: true })
    expect(evaluateWorkspaceBrokerApproval({ operation: 'request_delete' })).toMatchObject({ requiredCapability: 'delete', riskLevel: 'high', approvalRequired: true })
  })

  it('creates broker jobs honestly without claiming Google side effects', () => {
    const job = buildWorkspaceBrokerJobInput({
      operation: 'create_sheet',
      orgId: 'org-1',
      agentId: 'theo',
      input: { title: 'Budget', projectId: 'project-1', visibility: 'admin_agents_clients' },
    })

    expect(job).toMatchObject({
      orgId: 'org-1',
      operation: 'create_sheet',
      status: 'awaiting_approval',
      requiredCapability: 'write',
      riskLevel: 'medium',
      output: { googleMutationPerformed: false },
    })
  })

  it('detects Google ACLs that are broader than PiB visibility', () => {
    expect(detectWorkspaceAclAlignment({ visibility: 'admin_agents', anyoneWithLink: true, externalShared: false })).toBe('broader_than_pib')
    expect(detectWorkspaceAclAlignment({ visibility: 'admin_agents_clients', anyoneWithLink: false, externalShared: false })).toBe('aligned')
  })
})
