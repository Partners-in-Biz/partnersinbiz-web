import { readFileSync } from 'fs'
import path from 'path'

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('youtube studio route placeholders', () => {
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
})
