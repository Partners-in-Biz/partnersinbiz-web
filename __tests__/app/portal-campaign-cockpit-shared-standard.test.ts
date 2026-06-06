import { existsSync, readFileSync } from 'fs'
import path from 'path'

const root = process.cwd()

function readAppFile(filePath: string) {
  return readFileSync(path.join(root, filePath), 'utf8')
}

describe('portal campaign cockpit shared standard', () => {
  it('keeps the portal cockpit adapter in the shared campaign cockpit namespace', () => {
    const portalPage = readAppFile('app/(portal)/portal/campaigns/[id]/page.tsx')

    expect(existsSync(path.join(root, 'components/campaign-cockpit/PortalCampaignCockpitClient.tsx'))).toBe(true)
    expect(portalPage).toContain('@/components/campaign-cockpit/PortalCampaignCockpitClient')
    expect(portalPage).not.toContain('./cockpit-client')
  })

  it('uses one shared branded page frame for admin and portal campaign cockpits', () => {
    const adminPage = readAppFile('app/(admin)/admin/org/[slug]/social/[id]/page.tsx')
    const portalPage = readAppFile('app/(portal)/portal/campaigns/[id]/page.tsx')

    expect(existsSync(path.join(root, 'components/campaign-cockpit/CampaignCockpitFrame.tsx'))).toBe(true)

    for (const pageSource of [adminPage, portalPage]) {
      expect(pageSource).toContain('@/components/campaign-cockpit/CampaignCockpitFrame')
      expect(pageSource).not.toContain('function withAlpha')
      expect(pageSource).not.toContain('function monthLabel')
      expect(pageSource).not.toContain('backgroundImage:')
      expect(pageSource).not.toContain("import type { CSSProperties } from 'react'")
    }
  })
})
