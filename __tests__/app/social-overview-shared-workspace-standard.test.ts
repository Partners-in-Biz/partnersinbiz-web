import { readFileSync } from 'fs'
import path from 'path'

const root = process.cwd()

function source(file: string) {
  return readFileSync(path.join(root, file), 'utf8')
}

describe('social overview shared workspace standard', () => {
  const routes = [
    'app/(admin)/admin/org/[slug]/social/page.tsx',
    'app/(portal)/portal/social/page.tsx',
  ]

  it('keeps admin and portal social overview on one shared workspace', () => {
    for (const route of routes) {
      const file = source(route)

      expect(file).toContain('@/components/social/SocialOverviewWorkspace')
      expect(file).not.toContain('interface SocialPost')
      expect(file).not.toContain('interface SocialAccount')
      expect(file).not.toContain('interface CampaignRow')
      expect(file).not.toContain('interface PostRow')
      expect(file).not.toContain('interface Comment')
      expect(file).not.toContain('const PLATFORM_COLORS')
      expect(file).not.toContain('const POST_STATUS_PILL')
      expect(file).not.toContain('const POST_STATUS_LABEL')
      expect(file).not.toContain('const ACCOUNT_STATUS_PILL')
      expect(file).not.toContain('function PlatformBadge')
      expect(file).not.toContain('function StatusBadge')
      expect(file).not.toContain('function PostCard')
      expect(file).not.toContain('function CampaignCard')
      expect(file).not.toContain('function StandaloneCard')
      expect(file).not.toContain('function StatCard')
      expect(file).not.toContain('function StatTile')
      expect(file).not.toContain('function computeTotals')
      expect(file).not.toContain('function pickHero')
      expect(file).not.toContain('function getPostText')
      expect(file).not.toContain('function getPostPlatforms')
      expect(file).not.toContain('function tsToDate')
      expect(file).not.toContain('function fmtDate')
      expect(file).not.toContain('function fmtDateTime')
    }
  })

  it('keeps the org admin social overview scoped to the selected organisation', () => {
    const file = source('app/(admin)/admin/org/[slug]/social/page.tsx')

    expect(file).toContain('appendQueryParams')
    expect(file).toContain('buildApiPath')
    expect(file).toContain('orgId')
    expect(file).toContain('OrgThemedFrame')
    expect(file).toContain("`/admin/org/${encodeURIComponent(slug)}/social/standalone`")
    expect(file).not.toContain("scopedAdminHref('/admin/social/standalone')")
  })
})
