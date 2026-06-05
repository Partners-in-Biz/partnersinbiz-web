import { existsSync, readFileSync } from 'fs'
import path from 'path'

const repoRoot = process.cwd()

function source(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

describe('sequence analytics shared workspace standard', () => {
  it('keeps admin and portal sequence analytics drilldowns on one shared workspace', () => {
    const sharedWorkspacePath = path.join(
      repoRoot,
      'components/email-analytics/SequenceAnalyticsWorkspace.tsx',
    )
    const adminRoute = source('app/(admin)/admin/email-analytics/sequences/[id]/page.tsx')
    const portalRoute = source('app/(portal)/portal/email-analytics/sequences/[id]/page.tsx')

    expect(existsSync(sharedWorkspacePath)).toBe(true)
    expect(source('components/email-analytics/SequenceAnalyticsWorkspace.tsx')).toContain(
      'export function SequenceAnalyticsWorkspace',
    )

    expect(adminRoute).toContain('@/components/email-analytics/SequenceAnalyticsWorkspace')
    expect(portalRoute).toContain('@/components/email-analytics/SequenceAnalyticsWorkspace')

    for (const route of [adminRoute, portalRoute]) {
      expect(route).not.toContain('function Kpi')
      expect(route).not.toContain('function Section')
      expect(route).not.toContain('function Empty')
      expect(route).not.toContain('function formatStatus')
      expect(route).not.toContain('function formatPercent')
    }
  })
})
