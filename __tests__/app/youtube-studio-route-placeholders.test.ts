import { readFileSync } from 'fs'
import path from 'path'

const mockCookieGet = jest.fn()
const mockVerifySessionCookie = jest.fn()
const mockUserGet = jest.fn()
const mockOrgGet = jest.fn()
const mockCollection = jest.fn()
const mockCanUsePortalOrg = jest.fn()
const mockResolvePortalActiveOrgId = jest.fn()

jest.mock('next/headers', () => ({
  cookies: jest.fn(async () => ({ get: mockCookieGet })),
}))

jest.mock('next/navigation', () => ({
  redirect: jest.fn((href: string) => {
    throw new Error(`redirect:${href}`)
  }),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: mockVerifySessionCookie },
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/portal/org-access', () => ({
  canUsePortalOrg: mockCanUsePortalOrg,
  resolvePortalActiveOrgId: mockResolvePortalActiveOrgId,
}))

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

function textFromReactNode(node: unknown): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textFromReactNode).join(' ')
  if (typeof node === 'object' && 'props' in node) {
    const props = (node as { props?: { children?: unknown } }).props
    return textFromReactNode(props?.children)
  }
  return ''
}

describe('youtube studio route placeholders', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    mockCookieGet.mockReturnValue({ value: 'session-cookie' })
    mockVerifySessionCookie.mockResolvedValue({ uid: 'uid-1' })
    mockUserGet.mockResolvedValue({
      exists: true,
      data: () => ({ activeOrgId: 'org-1', orgIds: ['org-1'] }),
    })
    mockOrgGet.mockResolvedValue({
      exists: true,
      data: () => ({
        name: 'Acme Growth',
        settings: { portalModules: { youtubeStudio: true } },
      }),
    })
    mockResolvePortalActiveOrgId.mockResolvedValue('org-1')
    mockCanUsePortalOrg.mockResolvedValue(true)
    mockCollection.mockImplementation((name: string) => {
      if (name === 'users') return { doc: () => ({ get: mockUserGet }) }
      if (name === 'organizations') return { doc: () => ({ get: mockOrgGet }) }
      throw new Error(`Unexpected collection: ${name}`)
    })
  })

  it('keeps portal and admin org YouTube Studio routes resolvable and thin', () => {
    const adminRoute = source('app/(admin)/admin/org/[slug]/youtube-studio/page.tsx')
    const portalRoute = source('app/(portal)/portal/youtube-studio/page.tsx')
    const sharedShell = source('components/youtube-studio/YouTubeStudioPlaceholder.tsx')

    expect(adminRoute).toContain('adminDb')
    expect(adminRoute).toContain('notFound()')
    expect(adminRoute).toContain('YouTubeStudioPlaceholder')
    expect(adminRoute).toContain('surface="admin"')
    expect(adminRoute).not.toContain('useParams')

    expect(portalRoute).toContain("export const dynamic = 'force-dynamic'")
    expect(portalRoute).toContain('YouTubeStudioPlaceholder')
    expect(portalRoute).toContain('surface="portal"')

    expect(sharedShell).toContain('export function YouTubeStudioPlaceholder')
    expect(sharedShell).toContain('channel video requests')
    expect(sharedShell).toContain('Publishing gates')
  })

  it('does not render the portal YouTube Studio shell when the active organisation disables the module', async () => {
    mockOrgGet.mockResolvedValue({
      exists: true,
      data: () => ({
        name: 'Acme Growth',
        settings: { portalModules: { youtubeStudio: false } },
      }),
    })

    const Page = (await import('@/app/(portal)/portal/youtube-studio/page')).default
    const result = await Page({ searchParams: Promise.resolve({}) })
    const text = textFromReactNode(result)

    expect(text).toContain('YouTube Studio is not enabled for this portal.')
    expect(text).not.toContain('Phase 1 foundation')
    expect(mockOrgGet).toHaveBeenCalledTimes(1)
  })
})
