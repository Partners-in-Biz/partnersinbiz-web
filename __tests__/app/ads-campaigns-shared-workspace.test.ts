import { existsSync, readFileSync } from 'fs'
import path from 'path'

const root = process.cwd()

function readAppFile(filePath: string) {
  return readFileSync(path.join(root, filePath), 'utf8')
}

describe('ads campaign workspace reuse', () => {
  it('renders portal and admin ads campaign lists through the same workspace component', () => {
    const portal = readAppFile('app/(portal)/portal/ads/page.tsx')
    const admin = readAppFile('app/(admin)/admin/org/[slug]/ads/campaigns/page.tsx')

    expect(portal).toContain('@/components/ads/AdCampaignsWorkspace')
    expect(portal).toContain('@/components/ads/BulkApproveButton')
    expect(admin).toContain('@/components/ads/AdCampaignsWorkspace')
    expect(existsSync(path.join(root, 'components/ads/BulkApproveButton.tsx'))).toBe(true)
    expect(existsSync(path.join(root, 'app/(portal)/portal/ads/BulkApproveButton.tsx'))).toBe(false)
    expect(portal).not.toContain('./BulkApproveButton')
    expect(portal).not.toMatch(/function CampaignRow|STATUS_COLOR/)
    expect(admin).not.toMatch(/STATUS_TINT/)
  })

  it('keeps the shared ads workspace provider-neutral and connection-aware', () => {
    const portalLayout = readAppFile('app/(portal)/portal/ads/layout.tsx')
    const adminCampaigns = readAppFile('app/(admin)/admin/org/[slug]/ads/campaigns/page.tsx')
    const portalCampaigns = readAppFile('app/(portal)/portal/ads/page.tsx')
    const workspace = readAppFile('components/ads/AdCampaignsWorkspace.tsx')

    expect(portalLayout).toContain('multi-platform ad campaigns')
    expect(portalLayout).not.toContain('live Meta ad campaigns')
    expect(adminCampaigns).toContain('listConnections')
    expect(portalCampaigns).toContain('listConnections')
    expect(workspace).toContain('connectionSummaries')
    expect(workspace).toContain('Connected account')
    expect(workspace).toContain('No matching connection')
    expect(workspace).toContain('Account not selected')
  })

  it('renders portal and admin ads campaign details through the same workspace component', () => {
    const portal = readAppFile('app/(portal)/portal/ads/campaigns/[id]/page.tsx')
    const admin = readAppFile('app/(admin)/admin/org/[slug]/ads/campaigns/[id]/page.tsx')

    expect(portal).toContain('@/components/ads/AdCampaignDetailWorkspace')
    expect(admin).toContain('@/components/ads/AdCampaignDetailWorkspace')
    expect(portal).not.toMatch(/Awaiting your approval|Ad sets ·/)
    expect(admin).not.toMatch(/Awaiting client review|Ad sets \(/)
  })
})
