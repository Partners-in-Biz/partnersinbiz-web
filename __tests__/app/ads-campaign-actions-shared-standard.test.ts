import { existsSync, readFileSync } from 'fs'
import path from 'path'

const root = process.cwd()

function readAppFile(filePath: string) {
  return readFileSync(path.join(root, filePath), 'utf8')
}

describe('ads campaign action component standard', () => {
  it('keeps admin and portal campaign action controls in shared ads components', () => {
    const adminPage = readAppFile('app/(admin)/admin/org/[slug]/ads/campaigns/[id]/page.tsx')
    const portalPage = readAppFile('app/(portal)/portal/ads/campaigns/[id]/page.tsx')

    expect(existsSync(path.join(root, 'components/ads/AdCampaignAdminActions.tsx'))).toBe(true)
    expect(existsSync(path.join(root, 'components/ads/AdCampaignReviewActions.tsx'))).toBe(true)

    expect(adminPage).toContain('@/components/ads/AdCampaignAdminActions')
    expect(adminPage).not.toContain('./CampaignActionsClient')

    expect(portalPage).toContain('@/components/ads/AdCampaignReviewActions')
    expect(portalPage).not.toContain('./ApprovalActions')
  })
})
