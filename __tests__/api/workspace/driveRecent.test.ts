jest.mock('@/lib/google/userToken', () => ({ getFreshGoogleAccessToken: jest.fn(), googleAccountHasScopes: jest.requireActual('@/lib/google/userToken').googleAccountHasScopes }))
jest.mock('@/lib/workspace/currentUser', () => ({ resolveWorkspaceUser: jest.fn() }))

import { getFreshGoogleAccessToken } from '@/lib/google/userToken'
import { resolveWorkspaceUser } from '@/lib/workspace/currentUser'

describe('GET /api/v1/workspace/drive/recent', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns recent drive files', async () => {
    ;(resolveWorkspaceUser as jest.Mock).mockResolvedValue({ orgId: 'org-1', uid: 'u1' })
    ;(getFreshGoogleAccessToken as jest.Mock).mockResolvedValue({ ok: true, accessToken: 'tok', scopes: ['https://www.googleapis.com/auth/drive.metadata.readonly'], accountId: 'a1', emailAddress: 'me@x.com', displayName: 'Me' })
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ files: [
      { id: 'f1', name: 'Proposal.docx', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-06-18T08:00:00Z', webViewLink: 'https://docs.google.com/d/f1' },
    ] }) })) as unknown as typeof fetch
    const { GET } = await import('@/app/api/v1/workspace/drive/recent/route')
    const res = await GET(new Request('http://localhost/api/v1/workspace/drive/recent'))
    const body = await res.json()
    expect(body.data.status).toBe('connected')
    expect(body.data.files[0]).toMatchObject({ id: 'f1', name: 'Proposal.docx', webViewLink: 'https://docs.google.com/d/f1' })
  })

  it('returns needs_reconnect when the drive scope is missing', async () => {
    ;(resolveWorkspaceUser as jest.Mock).mockResolvedValue({ orgId: 'org-1', uid: 'u1' })
    ;(getFreshGoogleAccessToken as jest.Mock).mockResolvedValue({ ok: true, accessToken: 'tok', scopes: ['openid'], accountId: 'a1', emailAddress: 'me@x.com', displayName: 'Me' })
    const { GET } = await import('@/app/api/v1/workspace/drive/recent/route')
    const res = await GET(new Request('http://localhost/api/v1/workspace/drive/recent'))
    const body = await res.json()
    expect(body.data).toMatchObject({ status: 'needs_reconnect', files: [] })
  })
})
