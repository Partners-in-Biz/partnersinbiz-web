import { readFileSync } from 'fs'
import path from 'path'

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('youtube studio real route wrappers', () => {
  it('keeps the admin org route thin and mounted to governance controls', () => {
    const adminRoute = source('app/(admin)/admin/org/[slug]/youtube-studio/page.tsx')
    const adminGovernance = source('components/youtube-studio/AdminYouTubeStudioGovernanceWorkspace.tsx')

    expect(adminRoute).toContain('@/components/youtube-studio/AdminYouTubeStudioGovernanceWorkspace')
    expect(adminRoute).toContain('orgSlug={slug}')
    expect(adminRoute).not.toContain('@/components/youtube-studio/YouTubeStudioAdminWorkspace')
    expect(adminRoute).not.toContain('adminDb')
    expect(adminRoute).not.toContain('notFound()')
    expect(adminRoute).not.toContain('YouTubeStudioPlaceholder')
    expect(adminRoute).not.toContain('videos.map')
    expect(adminRoute).not.toContain('function Field')
    expect(adminGovernance).toContain('YouTube Studio governance')
    expect(adminGovernance).toContain('Who can use YouTube Studio')
  })

  it('keeps the portal route thin and delegates disabled-module handling to the workspace API flow', () => {
    const portalRoute = source('app/(portal)/portal/youtube-studio/page.tsx')
    const portalWorkspace = source('components/youtube-studio/YouTubeStudioPortalWorkspace.tsx')
    const portalApi = source('app/api/v1/portal/youtube-studio/route.ts')

    expect(portalRoute).toContain('@/components/youtube-studio/YouTubeStudioPortalWorkspace')
    expect(portalRoute).toContain("export const dynamic = 'force-dynamic'")
    expect(portalRoute).not.toContain('YouTubeStudioPlaceholder')
    expect(portalRoute).not.toContain('adminDb')
    expect(portalRoute).not.toContain('isPortalModuleEnabled')
    expect(portalRoute).not.toContain('videos.map')

    expect(portalWorkspace).toContain('body.moduleDisabled === true')
    expect(portalWorkspace).toContain('YouTube Studio is not enabled for this portal.')
    expect(portalApi).toContain('moduleDisabled: true')
    expect(portalApi).toContain("module: 'youtubeStudio'")
  })
})
