import { existsSync, readFileSync } from 'fs'
import path from 'path'

const repoRoot = process.cwd()

function source(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

describe('email campaign detail shared workspace standard', () => {
  it('keeps portal and admin company email campaign detail routes on one shared workspace', () => {
    const sharedWorkspacePath = path.join(
      repoRoot,
      'components/campaigns/EmailCampaignDetailWorkspace.tsx',
    )
    const portalRoute = source('app/(portal)/portal/campaigns/email/[id]/page.tsx')
    const adminCompanyRoute = source('app/(admin)/admin/org/[slug]/campaigns/[id]/page.tsx')

    expect(existsSync(sharedWorkspacePath)).toBe(true)
    const sharedWorkspace = source('components/campaigns/EmailCampaignDetailWorkspace.tsx')
    expect(sharedWorkspace).toContain(
      'export function EmailCampaignDetailWorkspace',
    )
    expect(sharedWorkspace).toContain('<span className="material-symbols-outlined text-base" aria-hidden="true">arrow_back</span>')
    expect(sharedWorkspace).not.toContain('<span className="material-symbols-outlined text-base">arrow_back</span>')

    expect(portalRoute).toContain('@/components/campaigns/EmailCampaignDetailWorkspace')
    expect(adminCompanyRoute).toContain('@/components/campaigns/EmailCampaignDetailWorkspace')

    expect(portalRoute).not.toContain('function KpiTile')
    expect(portalRoute).not.toContain('function StepRow')
    expect(portalRoute).not.toContain('function AbCard')

    expect(adminCompanyRoute).not.toContain('const STATUS_STYLES')
    expect(adminCompanyRoute).not.toContain('const EMPTY_STATS_LOCAL')
    expect(adminCompanyRoute).not.toContain('function pct(')
    expect(adminCompanyRoute).not.toContain('confirm(')
  })
})
