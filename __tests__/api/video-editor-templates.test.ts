import { NextRequest } from 'next/server'
import type { ApiUser } from '@/lib/api/types'

const mockTemplateAdd = jest.fn()
const mockTemplateWhere = jest.fn() as jest.Mock & { getResult?: jest.Mock }
const mockTemplateDocGet = jest.fn()
const mockTemplateDocSet = jest.fn()
const mockOrgGet = jest.fn()
const mockChannelGet = jest.fn()
const mockMediaGet = jest.fn()

let mockUser: ApiUser = { uid: 'admin-1', role: 'admin' } as ApiUser

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => {
      if (name === 'video_editor_templates') {
        return {
          add: mockTemplateAdd,
          doc: () => ({ get: mockTemplateDocGet, set: mockTemplateDocSet }),
          where: (...args: unknown[]) => {
            mockTemplateWhere(...args)
            return { get: mockTemplateWhere.getResult }
          },
        }
      }
      if (name === 'organizations') return { doc: () => ({ get: mockOrgGet }) }
      if (name === 'youtube_channel_workspaces') return { doc: () => ({ get: mockChannelGet }) }
      if (name === 'uploads') return { doc: () => ({ get: mockMediaGet }) }
      if (name === 'youtube_source_assets') return { doc: () => ({ get: mockMediaGet }) }
      if (name === 'creative_canvases') return { doc: () => ({ get: mockMediaGet }) }
      throw new Error(`Unexpected collection ${name}`)
    },
  },
}))

jest.mock('@/lib/api/auth', () => ({
  withAuth: (_role: string, handler: (req: NextRequest, user: ApiUser, context?: unknown) => Promise<Response>) =>
    (req: NextRequest, context?: unknown) => handler(req, mockUser, context),
}))

jest.mock('@/lib/youtube-studio/api', () => ({
  ensureOrgAccess: jest.fn().mockResolvedValue(null),
  actorFields: () => ({ createdBy: 'admin-1', createdByType: 'user' }),
  updateActorFields: () => ({ updatedBy: 'admin-1', updatedByType: 'user' }),
}))

const fragment = {
  version: 1,
  tracks: [{
    id: 'tpl-t',
    kind: 'text',
    clips: [{ id: 'tpl-c', timelineStart: 0, duration: 3, text: { content: '{{channel.title}}', fontSizePx: 64, color: '{{brand.primaryColor}}', align: 'center', animationPreset: 'none' } }],
  }],
}

function whereResults(orgDocs: unknown[], platformDocs: unknown[]) {
  let call = 0
  mockTemplateWhere.getResult = jest.fn().mockImplementation(() => {
    call += 1
    return Promise.resolve({ docs: call === 1 ? orgDocs : platformDocs })
  })
}

describe('video-editor templates routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    mockUser = { uid: 'admin-1', role: 'admin' } as ApiUser
    mockTemplateAdd.mockResolvedValue({ id: 'tpl-1' })
    mockTemplateDocSet.mockResolvedValue(undefined)
    mockOrgGet.mockResolvedValue({ exists: true, data: () => ({ name: 'Acme' }) })
    mockMediaGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'org-1', deleted: false }) })
    whereResults([], [])
  })

  it('GET merges org and platform templates', async () => {
    whereResults(
      [{ id: 'tpl-org', data: () => ({ orgId: 'org-1', title: 'Org intro', category: 'intro', fragment, deleted: false }) }],
      [{ id: 'tpl-plat', data: () => ({ orgId: 'platform', title: 'Platform outro', category: 'outro', fragment, deleted: false }) }],
    )
    const { GET } = await import('@/app/api/v1/video-editor/templates/route')
    const res = await GET(new NextRequest('http://localhost/api/v1/video-editor/templates?orgId=org-1'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.templates.map((template: { id: string }) => template.id).sort()).toEqual(['tpl-org', 'tpl-plat'])
  })

  it('POST creates an org template', async () => {
    const { POST } = await import('@/app/api/v1/video-editor/templates/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/video-editor/templates', {
      method: 'POST',
      body: JSON.stringify({ orgId: 'org-1', title: 'Lower third', category: 'lower_third', fragment }),
    }))
    expect(res.status).toBe(201)
    expect(mockTemplateAdd.mock.calls[0][0]).toMatchObject({ orgId: 'org-1', category: 'lower_third', deleted: false })
  })

  it('POST rejects platform templates from non-admins', async () => {
    mockUser = { uid: 'client-1', role: 'client', orgIds: ['org-1'] } as ApiUser
    const { POST } = await import('@/app/api/v1/video-editor/templates/route')
    const res = await POST(new NextRequest('http://localhost/api/v1/video-editor/templates', {
      method: 'POST',
      body: JSON.stringify({ orgId: 'platform', title: 'X', category: 'intro', fragment }),
    }))
    expect(res.status).toBe(403)
  })

  it('POST rejects invalid org media refs and tenant media in platform templates', async () => {
    const withMedia = {
      ...fragment,
      tracks: [{
        id: 'tpl-v',
        kind: 'video',
        clips: [{ id: 'media-c', timelineStart: 0, duration: 3, media: { type: 'upload', fileId: 'upload-1', url: 'https://x.test/v.mp4', mediaKind: 'video' } }],
      }],
    }
    mockMediaGet.mockResolvedValueOnce({ exists: true, data: () => ({ orgId: 'other-org', deleted: false }) })
    const { POST } = await import('@/app/api/v1/video-editor/templates/route')
    const orgRes = await POST(new NextRequest('http://localhost/api/v1/video-editor/templates', {
      method: 'POST',
      body: JSON.stringify({ orgId: 'org-1', title: 'Media intro', category: 'intro', fragment: withMedia }),
    }))
    expect(orgRes.status).toBe(400)
    expect(mockTemplateAdd).not.toHaveBeenCalled()

    const platformRes = await POST(new NextRequest('http://localhost/api/v1/video-editor/templates', {
      method: 'POST',
      body: JSON.stringify({ orgId: 'platform', title: 'Platform media', category: 'intro', fragment: withMedia }),
    }))
    expect(platformRes.status).toBe(400)
  })

  it('resolve returns the fragment with brand + channel variables applied', async () => {
    mockTemplateDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ orgId: 'platform', title: 'Intro', category: 'intro', fragment, deleted: false }),
    })
    mockOrgGet.mockResolvedValue({
      exists: true,
      data: () => ({ name: 'Acme', brandProfile: { colors: { secondary: '#00ff00' }, fonts: { heading: 'Sora' } }, settings: { brandColors: { primary: '#ff5500', secondary: '#111111' } } }),
    })
    mockChannelGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'org-1', title: 'Acme Films', deleted: false }) })
    const { POST } = await import('@/app/api/v1/video-editor/templates/[id]/resolve/route')
    const context = { params: Promise.resolve({ id: 'tpl-1' }) }
    const res = await POST(new NextRequest('http://localhost/api/v1/video-editor/templates/tpl-1/resolve?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({ channelWorkspaceId: 'ch-1' }),
    }), context)
    const body = await res.json()
    expect(res.status).toBe(200)
    const text = body.data.fragment.tracks[0].clips[0].text
    expect(text.content).toBe('Acme Films')
    expect(text.color).toBe('#ff5500')
  })

  it('resolve rejects invalid channel workspaces', async () => {
    mockTemplateDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ orgId: 'platform', title: 'Intro', category: 'intro', fragment, deleted: false }),
    })
    mockChannelGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'other-org', title: 'Other', deleted: false }) })
    const { POST } = await import('@/app/api/v1/video-editor/templates/[id]/resolve/route')
    const context = { params: Promise.resolve({ id: 'tpl-1' }) }
    const res = await POST(new NextRequest('http://localhost/api/v1/video-editor/templates/tpl-1/resolve?orgId=org-1', {
      method: 'POST',
      body: JSON.stringify({ channelWorkspaceId: 'ch-other' }),
    }), context)
    expect(res.status).toBe(404)
  })

  it('DELETE soft-deletes an org template but never a platform template for non-admins', async () => {
    mockTemplateDocGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'org-1', deleted: false }) })
    const { DELETE } = await import('@/app/api/v1/video-editor/templates/[id]/route')
    const context = { params: Promise.resolve({ id: 'tpl-1' }) }
    const res = await DELETE(new NextRequest('http://localhost/api/v1/video-editor/templates/tpl-1?orgId=org-1', { method: 'DELETE' }), context)
    expect(res.status).toBe(200)
    expect(mockTemplateDocSet).toHaveBeenCalledWith(expect.objectContaining({ deleted: true }), { merge: true })

    mockUser = { uid: 'client-1', role: 'client', orgIds: ['org-1'] } as ApiUser
    mockTemplateDocGet.mockResolvedValue({ exists: true, data: () => ({ orgId: 'platform', deleted: false }) })
    const res2 = await DELETE(new NextRequest('http://localhost/api/v1/video-editor/templates/tpl-1?orgId=org-1', { method: 'DELETE' }), context)
    expect(res2.status).toBe(403)
  })
})
