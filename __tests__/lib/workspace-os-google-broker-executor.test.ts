const mockGoogleAuth = jest.fn()
const mockDrive = jest.fn()
const mockDocs = jest.fn()
const mockSheets = jest.fn()
const mockAdd = jest.fn()
const mockDoc = jest.fn()
const mockGetDoc = jest.fn()
const mockUpdateDoc = jest.fn()
const mockCollection = jest.fn()
const mockServerTimestamp = jest.fn(() => 'SERVER_TIMESTAMP')

jest.mock('googleapis', () => ({
  google: {
    auth: { GoogleAuth: mockGoogleAuth },
    drive: mockDrive,
    docs: mockDocs,
    sheets: mockSheets,
  },
}))

jest.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: mockCollection } }))
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: mockServerTimestamp } }))

function setupGoogleClients() {
  const drive = {
    files: {
      create: jest.fn(),
      copy: jest.fn(),
      get: jest.fn(),
      update: jest.fn(),
      export: jest.fn(),
      delete: jest.fn(),
    },
    permissions: { list: jest.fn() },
  }
  const docs = { documents: { create: jest.fn(), batchUpdate: jest.fn() } }
  const sheets = { spreadsheets: { create: jest.fn() } }
  mockDrive.mockReturnValue(drive)
  mockDocs.mockReturnValue(docs)
  mockSheets.mockReturnValue(sheets)
  return { drive, docs, sheets }
}

const approvedConnection = {
  orgId: 'org-1',
  provider: 'google_workspace',
  status: 'active',
  approvalStatus: 'approved',
  tokenStatus: 'valid',
  capabilityScopes: ['write'],
  capabilities: { driveWrite: true, docsWrite: true, sheetsWrite: true },
  deleted: false,
}

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  process.env.GOOGLE_WORKSPACE_CREDS_JSON_PATH = '/approved/workspace-sa.json'
  mockDoc.mockReturnValue({ get: mockGetDoc, update: mockUpdateDoc })
  mockCollection.mockImplementation((name: string) => {
    if (!['workspace_artifacts', 'workspace_connections'].includes(name)) throw new Error(`Unexpected collection: ${name}`)
    return { add: mockAdd, doc: mockDoc }
  })
})

describe('Google Workspace broker executor', () => {
  it('creates Sheets with the server credential path and links the provider artifact into PiB metadata', async () => {
    const { drive, sheets } = setupGoogleClients()
    drive.files.get.mockResolvedValueOnce({ data: { parents: ['root'] } })
    drive.files.update.mockResolvedValueOnce({ data: { id: 'sheet-1', parents: ['folder-1'] } })
    sheets.spreadsheets.create.mockResolvedValueOnce({ data: { spreadsheetId: 'sheet-1', spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-1/edit' } })
    mockGetDoc.mockResolvedValueOnce({ exists: true, data: () => approvedConnection })
    mockAdd.mockResolvedValueOnce({ id: 'artifact-sheet-1' })

    const { executeWorkspaceBrokerJob } = await import('@/lib/workspace-os/googleBrokerExecutor')
    const result = await executeWorkspaceBrokerJob({
      id: 'job-1',
      orgId: 'org-1',
      operation: 'create_sheet',
      status: 'queued',
      connectionId: 'conn-1',
      requiredCapability: 'write',
      approvalStatus: 'approved',
      approvalGateTaskId: 'gate-1',
      approvalSatisfied: true,
      approvalEvidence: { gateTaskId: 'gate-1', status: 'approved', decidedBy: 'pip', decidedAt: '2026-06-05T10:00:00.000Z' },
      input: { title: 'Budget', folderId: 'folder-1', projectId: 'project-1', taskId: 'task-1', credentialsPath: '/untrusted/body.json' },
    } as never)

    expect(mockGoogleAuth).toHaveBeenCalledWith(expect.objectContaining({
      keyFile: '/approved/workspace-sa.json',
      scopes: expect.arrayContaining(['https://www.googleapis.com/auth/spreadsheets']),
    }))
    expect(sheets.spreadsheets.create).toHaveBeenCalledWith({ requestBody: { properties: { title: 'Budget' } } })
    expect(drive.files.update).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'sheet-1', addParents: 'folder-1' }))
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      artifactType: 'google_sheet',
      google: expect.objectContaining({ fileId: 'sheet-1' }),
      projectId: 'project-1',
      taskId: 'task-1',
      safeMetadata: expect.objectContaining({ brokerJobId: 'job-1', providerFileId: 'sheet-1' }),
    }))
    expect(result).toMatchObject({ googleMutationPerformed: true, providerResultIds: ['sheet-1'], artifactIds: ['artifact-sheet-1'] })
    expect(result.output).toMatchObject({ credentialPathEnv: 'GOOGLE_WORKSPACE_CREDS_JSON_PATH' })
  })

  it('reads Drive metadata and permission state without performing Google mutations', async () => {
    const { drive } = setupGoogleClients()
    mockGetDoc.mockResolvedValueOnce({ exists: true, data: () => ({ orgId: 'org-1', title: 'Plan', google: { fileId: 'doc-1' } }) })
    drive.files.get.mockResolvedValueOnce({ data: { id: 'doc-1', name: 'Plan', mimeType: 'application/vnd.google-apps.document', webViewLink: 'https://docs.google.com/document/d/doc-1/edit', parents: ['folder-1'], modifiedTime: '2026-06-05T10:00:00.000Z' } })
    drive.permissions.list.mockResolvedValueOnce({ data: { permissions: [{ type: 'user', role: 'writer', emailAddress: 'person@example.com' }] } })

    const { executeWorkspaceBrokerJob } = await import('@/lib/workspace-os/googleBrokerExecutor')
    const result = await executeWorkspaceBrokerJob({
      id: 'job-2',
      orgId: 'org-1',
      operation: 'permission_audit',
      status: 'queued',
      requiredCapability: 'review',
      input: { artifactId: 'artifact-doc-1' },
    } as never)

    expect(drive.files.create).not.toHaveBeenCalled()
    expect(drive.files.delete).not.toHaveBeenCalled()
    expect(mockUpdateDoc).toHaveBeenCalledWith(expect.objectContaining({
      google: expect.objectContaining({ fileId: 'doc-1', webViewLink: 'https://docs.google.com/document/d/doc-1/edit' }),
      permissions: expect.objectContaining({ anyoneWithLink: false, externalShared: true, providerPermissionCount: 1 }),
    }))
    expect(result).toMatchObject({ googleMutationPerformed: false, providerResultIds: ['doc-1'], artifactIds: ['artifact-doc-1'] })
  })

  it('rejects artifact-scoped execution when the artifact org does not match the broker job org', async () => {
    for (const operation of ['permission_audit', 'inventory_refresh', 'export_pdf'] as const) {
      jest.clearAllMocks()
      const { drive } = setupGoogleClients()
      mockDoc.mockReturnValue({ get: mockGetDoc, update: mockUpdateDoc })
      if (operation === 'export_pdf') {
        mockGetDoc
          .mockResolvedValueOnce({ exists: true, data: () => approvedConnection })
          .mockResolvedValueOnce({ exists: true, data: () => ({ orgId: 'org-other', title: 'Other tenant plan', google: { fileId: 'doc-other' } }) })
      } else {
        mockGetDoc.mockResolvedValueOnce({ exists: true, data: () => ({ orgId: 'org-other', title: 'Other tenant plan', google: { fileId: 'doc-other' } }) })
      }

      const { executeWorkspaceBrokerJob } = await import('@/lib/workspace-os/googleBrokerExecutor')
      await expect(executeWorkspaceBrokerJob({
        id: `job-org-mismatch-${operation}`,
        orgId: 'org-1',
        operation,
        status: 'queued',
        connectionId: operation === 'export_pdf' ? 'conn-1' : null,
        requiredCapability: operation === 'export_pdf' ? 'write' : 'read',
        approvalRequired: operation === 'export_pdf',
        approvalSatisfied: operation === 'export_pdf',
        approvalStatus: operation === 'export_pdf' ? 'approved' : null,
        approvalGateTaskId: operation === 'export_pdf' ? 'gate-export' : null,
        approvalEvidence: operation === 'export_pdf' ? { gateTaskId: 'gate-export', status: 'approved', decidedBy: 'pip', decidedAt: '2026-06-05T10:00:00.000Z' } : { gateTaskId: null, status: null },
        input: { artifactId: 'artifact-other' },
      } as never)).rejects.toThrow('Workspace artifact orgId does not match broker job orgId')

      expect(drive.files.get).not.toHaveBeenCalled()
      expect(drive.files.export).not.toHaveBeenCalled()
      expect(drive.permissions.list).not.toHaveBeenCalled()
      expect(mockUpdateDoc).not.toHaveBeenCalled()
    }
  })

  it('blocks direct Google mutation executor calls without persisted approval evidence', async () => {
    const { drive } = setupGoogleClients()
    const { executeWorkspaceBrokerJob } = await import('@/lib/workspace-os/googleBrokerExecutor')

    await expect(executeWorkspaceBrokerJob({
      id: 'job-no-approval',
      orgId: 'org-1',
      operation: 'create_doc',
      status: 'queued',
      requiredCapability: 'write',
      approvalRequired: false,
      approvalSatisfied: false,
      approvalStatus: null,
      approvalGateTaskId: null,
      approvalEvidence: { gateTaskId: null, status: null },
      input: { title: 'No approval doc' },
    } as never)).rejects.toThrow('Workspace broker approval evidence is required before execution')

    expect(drive.files.create).not.toHaveBeenCalled()
    expect(mockGoogleAuth).not.toHaveBeenCalled()
  })

  it('blocks direct Google mutation execution when the persisted connection is not approved and healthy', async () => {
    const { drive } = setupGoogleClients()
    mockGetDoc.mockResolvedValueOnce({ exists: true, data: () => ({ ...approvedConnection, status: 'paused' }) })

    const { executeWorkspaceBrokerJob } = await import('@/lib/workspace-os/googleBrokerExecutor')
    await expect(executeWorkspaceBrokerJob({
      id: 'job-paused-connection',
      orgId: 'org-1',
      operation: 'create_doc',
      status: 'queued',
      connectionId: 'conn-paused',
      requiredCapability: 'write',
      approvalRequired: true,
      approvalSatisfied: true,
      approvalStatus: 'approved',
      approvalGateTaskId: 'gate-connection',
      approvalEvidence: { gateTaskId: 'gate-connection', status: 'approved', decidedBy: 'pip', decidedAt: '2026-06-05T10:00:00.000Z' },
      input: { title: 'Paused connection doc' },
    } as never)).rejects.toThrow('Workspace connection must be active or approved before broker mutation jobs can be queued')

    expect(drive.files.create).not.toHaveBeenCalled()
    expect(mockGoogleAuth).not.toHaveBeenCalled()
  })

  it('rolls back created Google files when PiB artifact linking fails', async () => {
    const { drive } = setupGoogleClients()
    drive.files.create.mockResolvedValueOnce({ data: { id: 'folder-1', name: 'Evidence', mimeType: 'application/vnd.google-apps.folder', webViewLink: 'https://drive.google.com/drive/folders/folder-1', parents: ['parent-1'] } })
    drive.files.delete.mockResolvedValueOnce({ data: {} })
    mockGetDoc.mockResolvedValueOnce({ exists: true, data: () => approvedConnection })
    mockAdd.mockRejectedValueOnce(new Error('metadata link failed'))

    const { executeWorkspaceBrokerJob } = await import('@/lib/workspace-os/googleBrokerExecutor')
    await expect(executeWorkspaceBrokerJob({
      id: 'job-3',
      orgId: 'org-1',
      operation: 'create_folder',
      status: 'queued',
      connectionId: 'conn-1',
      requiredCapability: 'write',
      approvalRequired: true,
      approvalSatisfied: true,
      approvalStatus: 'approved',
      approvalGateTaskId: 'gate-rollback',
      approvalEvidence: { gateTaskId: 'gate-rollback', status: 'approved', decidedBy: 'pip', decidedAt: '2026-06-05T10:00:00.000Z' },
      input: { title: 'Evidence', parentFolderId: 'parent-1' },
    } as never)).rejects.toThrow('metadata link failed')

    expect(drive.files.delete).toHaveBeenCalledWith({ fileId: 'folder-1' })
  })
})

