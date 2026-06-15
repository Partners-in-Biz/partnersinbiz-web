const mockGoogleAuth = jest.fn()
const mockDrive = jest.fn()
const mockDocs = jest.fn()
const mockSheets = jest.fn()

jest.mock('googleapis', () => ({
  google: {
    auth: { GoogleAuth: mockGoogleAuth },
    drive: mockDrive,
    docs: mockDocs,
    sheets: mockSheets,
  },
}))

describe('Google Workspace service-account client', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    delete process.env.GOOGLE_WORKSPACE_CREDS_JSON
    delete process.env.GOOGLE_WORKSPACE_CREDS_JSON_PATH
    mockDrive.mockReturnValue({ kind: 'drive' })
    mockDocs.mockReturnValue({ kind: 'docs' })
    mockSheets.mockReturnValue({ kind: 'sheets' })
  })

  it('builds Google clients from raw JSON credentials for hosted environments', async () => {
    process.env.GOOGLE_WORKSPACE_CREDS_JSON = JSON.stringify({
      client_email: 'workspace-agent@partners-in-biz-85059.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----\\n',
    })

    const { buildGoogleWorkspaceClients } = await import('@/lib/google-workspace/client')
    const clients = await buildGoogleWorkspaceClients()

    expect(mockGoogleAuth).toHaveBeenCalledWith(expect.objectContaining({
      credentials: expect.objectContaining({
        client_email: 'workspace-agent@partners-in-biz-85059.iam.gserviceaccount.com',
        private_key: expect.stringContaining('BEGIN PRIVATE KEY'),
      }),
      scopes: expect.arrayContaining([
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/documents',
        'https://www.googleapis.com/auth/spreadsheets',
      ]),
    }))
    expect(mockGoogleAuth.mock.calls[0][0]).not.toHaveProperty('keyFile')
    expect(mockDrive).toHaveBeenCalledWith({ version: 'v3', auth: expect.anything() })
    expect(mockDocs).toHaveBeenCalledWith({ version: 'v1', auth: expect.anything() })
    expect(mockSheets).toHaveBeenCalledWith({ version: 'v4', auth: expect.anything() })
    expect(clients.credentialSource).toEqual({ env: 'GOOGLE_WORKSPACE_CREDS_JSON', kind: 'json' })
  })

  it('falls back to the service-account key file path for Mac and VPS runtimes', async () => {
    process.env.GOOGLE_WORKSPACE_CREDS_JSON_PATH = '/etc/hermes/google-drive-sa.json'

    const { buildGoogleWorkspaceClients } = await import('@/lib/google-workspace/client')
    const clients = await buildGoogleWorkspaceClients(['https://www.googleapis.com/auth/drive.readonly'])

    expect(mockGoogleAuth).toHaveBeenCalledWith({
      keyFile: '/etc/hermes/google-drive-sa.json',
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    })
    expect(clients.credentialSource).toEqual({
      env: 'GOOGLE_WORKSPACE_CREDS_JSON_PATH',
      kind: 'path',
      path: '/etc/hermes/google-drive-sa.json',
    })
  })

  it('fails closed when no service-account credential source is configured', async () => {
    const { buildGoogleWorkspaceClients } = await import('@/lib/google-workspace/client')

    await expect(buildGoogleWorkspaceClients()).rejects.toThrow(
      'GOOGLE_WORKSPACE_CREDS_JSON or GOOGLE_WORKSPACE_CREDS_JSON_PATH is required',
    )
    expect(mockGoogleAuth).not.toHaveBeenCalled()
  })
})
