import { existsSync, readFileSync } from 'fs'
import path from 'path'

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('campaigns shared workspace standard', () => {
  it('keeps portal and admin org campaign routes thin and shares the campaign workspace surface', () => {
    const portalRoute = source('app/(portal)/portal/campaigns/page.tsx')
    const adminOrgRoute = source('app/(admin)/admin/org/[slug]/campaigns/page.tsx')
    const sharedWorkspacePath = path.join(process.cwd(), 'components/campaigns/CampaignsWorkspace.tsx')
    const sharedRequestPanelPath = path.join(process.cwd(), 'components/campaigns/CampaignRequestPanel.tsx')

    expect(existsSync(sharedWorkspacePath)).toBe(true)
    expect(existsSync(sharedRequestPanelPath)).toBe(true)
    expect(source('components/campaigns/CampaignsWorkspace.tsx')).toContain('export function CampaignsWorkspace')
    expect(source('components/campaigns/CampaignRequestPanel.tsx')).toContain('export function CampaignRequestPanel')

    expect(portalRoute).toContain('@/components/campaigns/CampaignsWorkspace')
    expect(portalRoute).toContain('@/components/campaigns/CampaignRequestPanel')
    expect(portalRoute).not.toContain('./CampaignRequestPanel')
    expect(portalRoute).not.toContain('function StatTile')
    expect(portalRoute).not.toContain('function SectionHeader')
    expect(portalRoute).not.toContain('function EmailCampaignCard')
    expect(portalRoute).not.toContain('function BroadcastRow')
    expect(portalRoute).not.toContain('function FeatureCallout')

    expect(adminOrgRoute).toContain('@/components/campaigns/CampaignsWorkspace')
    expect(adminOrgRoute).not.toContain('function StatTile')
    expect(adminOrgRoute).not.toContain('function CampaignSection')
    expect(adminOrgRoute).not.toContain('function CampaignRequests')
    expect(adminOrgRoute).not.toContain('function EmailCampaignCard')
    expect(adminOrgRoute).not.toContain('function MiniStat')

  })
})
