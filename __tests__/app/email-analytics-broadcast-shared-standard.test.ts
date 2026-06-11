import { existsSync, readFileSync } from 'fs'
import path from 'path'

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('email analytics broadcast detail shared standard', () => {
  it('keeps admin and portal broadcast analytics details on one shared workspace', () => {
    const sharedPath = path.join(
      process.cwd(),
      'components/email-analytics/BroadcastAnalyticsWorkspace.tsx',
    )
    const portalRoutePath = path.join(
      process.cwd(),
      'app/(portal)/portal/email-analytics/broadcasts/[id]/page.tsx',
    )

    expect(existsSync(sharedPath)).toBe(true)
    expect(existsSync(portalRoutePath)).toBe(true)

    const shared = source('components/email-analytics/BroadcastAnalyticsWorkspace.tsx')
    const portalRoute = source('app/(portal)/portal/email-analytics/broadcasts/[id]/page.tsx')

    expect(shared).toContain('export function BroadcastAnalyticsWorkspace')
    expect(shared).toContain('scopedApiPath')
    expect(shared).toContain('scopedPortalPath')

    expect(portalRoute).toContain('@/components/email-analytics/BroadcastAnalyticsWorkspace')
    expect(portalRoute).toContain('searchParams')
    expect(portalRoute).toContain('surface="portal"')

  })
})
