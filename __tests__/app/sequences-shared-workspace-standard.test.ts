import { existsSync, readFileSync } from 'fs'
import path from 'path'

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('sequences shared workspace standard', () => {
  it('keeps admin and portal sequence list pages on one shared command-center workspace', () => {
    const sharedPath = path.join(process.cwd(), 'components/crm/SequencesWorkspace.tsx')
    const portalRoute = source('app/(portal)/portal/settings/sequences/page.tsx')

    expect(existsSync(sharedPath)).toBe(true)
    expect(source('components/crm/SequencesWorkspace.tsx')).toContain('export function SequencesWorkspace')

    expect(portalRoute).toContain('@/components/crm/SequencesWorkspace')

    for (const route of [portalRoute]) {
      expect(route).not.toContain('function stepReady')
      expect(route).not.toContain('function sequenceGaps')
      expect(route).not.toContain('function readinessScore')
      expect(route).not.toContain('function StatusBadge')
      expect(route).not.toContain('function StatCard')
    }

    expect(portalRoute).toContain('surface="portal"')
  })
})
