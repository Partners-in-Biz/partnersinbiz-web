import { readFileSync } from 'fs'
import path from 'path'

const root = process.cwd()

function source(file: string) {
  return readFileSync(path.join(root, file), 'utf8')
}

describe('social overview shared workspace standard', () => {
  const routes = [
    'app/(admin)/admin/social/page.tsx',
    'app/(portal)/portal/social/page.tsx',
  ]

  it('keeps admin and portal social overview on one shared workspace', () => {
    for (const route of routes) {
      const file = source(route)

      expect(file).toContain('@/components/social/SocialOverviewWorkspace')
      expect(file).not.toContain('interface SocialPost')
      expect(file).not.toContain('interface SocialAccount')
      expect(file).not.toContain('interface Comment')
      expect(file).not.toContain('const PLATFORM_COLORS')
      expect(file).not.toContain('const POST_STATUS_PILL')
      expect(file).not.toContain('const POST_STATUS_LABEL')
      expect(file).not.toContain('const ACCOUNT_STATUS_PILL')
      expect(file).not.toContain('function PlatformBadge')
      expect(file).not.toContain('function StatusBadge')
      expect(file).not.toContain('function PostCard')
      expect(file).not.toContain('function StatCard')
      expect(file).not.toContain('function getPostText')
      expect(file).not.toContain('function getPostPlatforms')
      expect(file).not.toContain('function tsToDate')
      expect(file).not.toContain('function fmtDate')
      expect(file).not.toContain('function fmtDateTime')
    }
  })
})
