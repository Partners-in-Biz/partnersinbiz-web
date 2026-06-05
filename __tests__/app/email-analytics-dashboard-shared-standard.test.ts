import { existsSync, readFileSync } from 'fs'
import path from 'path'

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('email analytics shared dashboard standard', () => {
  it('keeps admin and portal email analytics on shared dashboard components instead of admin-owned UI', () => {
    const adminPage = source('app/(admin)/admin/email-analytics/page.tsx')
    const portalPage = source('app/(portal)/portal/email-analytics/page.tsx')
    const portalClientPath = path.join(
      process.cwd(),
      'app/(portal)/portal/email-analytics/EmailAnalyticsClient.tsx',
    )
    const sharedDashboardPath = path.join(
      process.cwd(),
      'components/email-analytics/EmailAnalyticsDashboard.tsx',
    )
    const sharedChartsPath = path.join(process.cwd(), 'components/email-analytics/charts.tsx')

    expect(existsSync(sharedDashboardPath)).toBe(true)
    expect(existsSync(sharedChartsPath)).toBe(true)
    expect(adminPage).toContain('@/components/email-analytics/EmailAnalyticsDashboard')
    expect(portalPage).toContain('@/components/email-analytics/EmailAnalyticsDashboard')
    expect(adminPage).not.toContain('@/components/admin/email-analytics')
    expect(portalPage).not.toContain('@/components/admin/email-analytics')
    expect(portalPage).not.toContain('./EmailAnalyticsClient')
    expect(existsSync(portalClientPath)).toBe(false)
  })
})
