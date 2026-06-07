import { readFileSync } from 'fs'
import path from 'path'

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('youtube studio shared workspace standard', () => {
  it('keeps portal and admin routes thin and shares YouTube Studio workspaces', () => {
    const adminRoute = source('app/(admin)/admin/org/[slug]/youtube-studio/page.tsx')
    const portalRoute = source('app/(portal)/portal/youtube-studio/page.tsx')

    expect(adminRoute).toContain('@/components/youtube-studio/YouTubeStudioAdminWorkspace')
    expect(adminRoute).toContain('adminDb')
    expect(adminRoute).toContain('orgId={orgDoc.id}')
    expect(adminRoute).not.toContain('videos.map')
    expect(adminRoute).not.toContain('function Field')

    expect(portalRoute).toContain('@/components/youtube-studio/YouTubeStudioPortalWorkspace')
    expect(portalRoute).toContain('searchParams?: Promise<PortalYouTubeStudioSearchParams>')
    expect(portalRoute).toContain('orgId={orgId || undefined}')
    expect(portalRoute).not.toContain('videos.map')

    const adminWorkspace = source('components/youtube-studio/YouTubeStudioAdminWorkspace.tsx')
    const portalWorkspace = source('components/youtube-studio/YouTubeStudioPortalWorkspace.tsx')
    const shell = source('components/youtube-studio/YouTubeStudioWorkspaceShell.tsx')
    const cards = source('components/youtube-studio/YouTubeStudioCards.tsx')

    expect(shell).toContain('export function YouTubeStudioWorkspaceShell')
    expect(cards).toContain('export function YouTubeVideoCard')
    expect(adminWorkspace).toContain('@/components/youtube-studio/YouTubeStudioWorkspaceShell')
    expect(adminWorkspace).toContain('finally')
    expect(adminWorkspace).toContain("setNotice('Could not save YouTube channel workspace')")
    expect(adminWorkspace).toContain("setNotice('Could not save video project')")
    expect(portalWorkspace).toContain('@/components/youtube-studio/YouTubeStudioWorkspaceShell')
    expect(portalWorkspace).toContain("scopedApiPath('/api/v1/portal/youtube-studio'")
    expect(portalWorkspace).toContain('submittingRequest')
    expect(portalWorkspace).toContain('reviewingId')
    expect(cards).toContain('min-w-0')
    expect(cards).toContain('break-words')
    expect(cards).toContain('shrink-0 whitespace-nowrap')
  })
})
