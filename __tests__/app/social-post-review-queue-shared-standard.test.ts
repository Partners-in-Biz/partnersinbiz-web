import { existsSync, readFileSync } from 'fs'
import path from 'path'

const root = process.cwd()

function source(file: string) {
  return readFileSync(path.join(root, file), 'utf8')
}

describe('social post review queue shared standard', () => {
  const routes = [
    'app/(admin)/admin/social/qa/page.tsx',
    'app/(portal)/portal/social/review/page.tsx',
  ]

  it('keeps admin QA and portal client review queues on one shared workspace', () => {
    const sharedWorkspacePath = path.join(root, 'components/social-review/SocialPostReviewQueueWorkspace.tsx')

    expect(existsSync(sharedWorkspacePath)).toBe(true)
    expect(source('components/social-review/SocialPostReviewQueueWorkspace.tsx')).toContain(
      'export function SocialPostReviewQueueWorkspace',
    )

    for (const route of routes) {
      const file = source(route)

      expect(file).toContain('@/components/social-review/SocialPostReviewQueueWorkspace')
      expect(file).not.toContain('@/components/social-review/SocialPostReviewQueueCard')
      expect(file).not.toContain('useState')
      expect(file).not.toContain('useEffect')
      expect(file).not.toContain('fetch(')
      expect(file).not.toContain('function PlatformBadge')
      expect(file).not.toContain('const PLATFORM_COLORS')
      expect(file).not.toContain('function getPostText')
      expect(file).not.toContain('function getPostPlatforms')
      expect(file).not.toContain('function ReviewCard')
      expect(file).not.toContain('function MediaThumbs')
      expect(file).not.toContain('function timeAgo')
      expect(file).not.toContain('function fmtRelative')
    }
  })
})
