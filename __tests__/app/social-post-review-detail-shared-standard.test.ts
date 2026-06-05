import { readFileSync } from 'fs'
import path from 'path'

const root = process.cwd()

function source(file: string) {
  return readFileSync(path.join(root, file), 'utf8')
}

describe('social post review detail shared standard', () => {
  const routes = [
    'app/(admin)/admin/social/qa/[id]/page.tsx',
    'app/(portal)/portal/social/review/[id]/page.tsx',
  ]

  it('keeps admin QA and portal review detail routes on the shared review workspace', () => {
    for (const route of routes) {
      const file = source(route)

      expect(file).toContain('@/components/social-review/SocialPostReviewWorkspace')
      expect(file).not.toContain('function PlatformChip')
      expect(file).not.toContain('function PlatformBadge')
      expect(file).not.toContain('function MediaGrid')
      expect(file).not.toContain('function MediaThumbs')
      expect(file).not.toContain('function CommentItem')
      expect(file).not.toContain('const PLATFORM_COLORS')
    }
  })
})
