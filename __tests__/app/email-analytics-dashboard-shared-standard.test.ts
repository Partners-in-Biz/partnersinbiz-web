import { existsSync, readFileSync } from 'fs'
import path from 'path'

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('email analytics shared dashboard standard', () => {
  it('keeps portal email analytics on the shared dashboard instead of a forked client workspace', () => {
    const portalPage = source('app/(portal)/portal/email-analytics/page.tsx')
    const portalClientPath = path.join(
      process.cwd(),
      'app/(portal)/portal/email-analytics/EmailAnalyticsClient.tsx',
    )

    expect(portalPage).toContain('@/components/admin/email-analytics/EmailAnalyticsDashboard')
    expect(portalPage).not.toContain('./EmailAnalyticsClient')
    expect(existsSync(portalClientPath)).toBe(false)
  })
})
