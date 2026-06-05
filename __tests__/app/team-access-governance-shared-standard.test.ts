import fs from 'fs'
import path from 'path'

const root = process.cwd()

function source(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('team access governance shared standard', () => {
  it('uses one shared governance panel for admin org and portal team settings', () => {
    const sharedPath = path.join(root, 'components/settings/TeamAccessGovernancePanel.tsx')

    expect(fs.existsSync(sharedPath)).toBe(true)
    expect(source('components/settings/TeamAccessGovernancePanel.tsx')).toContain(
      'export function TeamAccessGovernancePanel',
    )

    for (const route of [
      'app/(admin)/admin/org/[slug]/team/page.tsx',
      'app/(portal)/portal/settings/team/page.tsx',
    ]) {
      const file = source(route)
      expect(file).toContain('@/components/settings/TeamAccessGovernancePanel')
      expect(file).not.toContain('aria-label="Team access governance"')
      expect(file).not.toContain('Employee access needs CRM coverage')
    }
  })
})
