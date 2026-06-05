import { existsSync, readFileSync } from 'fs'
import path from 'path'

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('sequences shared workspace standard', () => {
  it('keeps admin and portal sequence list pages on one shared command-center workspace', () => {
    const sharedPath = path.join(process.cwd(), 'components/crm/SequencesWorkspace.tsx')
    const adminRoute = source('app/(admin)/admin/sequences/page.tsx')
    const adminNewRoute = source('app/(admin)/admin/sequences/new/page.tsx')
    const adminEditRoute = source('app/(admin)/admin/sequences/[id]/page.tsx')
    const portalRoute = source('app/(portal)/portal/settings/sequences/page.tsx')

    expect(existsSync(sharedPath)).toBe(true)
    expect(source('components/crm/SequencesWorkspace.tsx')).toContain('export function SequencesWorkspace')

    expect(adminRoute).toContain('@/components/crm/SequencesWorkspace')
    expect(portalRoute).toContain('@/components/crm/SequencesWorkspace')

    for (const route of [adminRoute, portalRoute]) {
      expect(route).not.toContain('function stepReady')
      expect(route).not.toContain('function sequenceGaps')
      expect(route).not.toContain('function readinessScore')
      expect(route).not.toContain('function StatusBadge')
      expect(route).not.toContain('function StatCard')
    }

    expect(adminRoute).not.toContain('/api/v1/sequences')
    expect(adminRoute).not.toContain('STATUS_COLORS')
    expect(adminNewRoute).toContain('@/components/crm/SequenceForm')
    expect(adminNewRoute).toContain('apiScope={orgScope}')
    expect(adminEditRoute).toContain('@/components/crm/SequenceForm')
    expect(adminEditRoute).toContain('scopedApiPath')
    expect(adminEditRoute).not.toContain('/api/v1/sequences')
    expect(portalRoute).toContain('surface="portal"')
  })
})
