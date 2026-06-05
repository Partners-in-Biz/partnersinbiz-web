import fs from 'fs'
import path from 'path'

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('segments rule editors shared standard', () => {
  it('keeps portal segments on shared CRM rule editors instead of admin-owned components', () => {
    const behavioralPath = path.join(process.cwd(), 'components/crm/segments/BehavioralRuleEditor.tsx')
    const engagementPath = path.join(process.cwd(), 'components/crm/segments/EngagementRuleEditor.tsx')

    expect(fs.existsSync(behavioralPath)).toBe(true)
    expect(fs.existsSync(engagementPath)).toBe(true)

    const portalSegmentsPage = source('app/(portal)/portal/segments/page.tsx')
    const behavioralEditor = source('components/crm/segments/BehavioralRuleEditor.tsx')
    const engagementEditor = source('components/crm/segments/EngagementRuleEditor.tsx')

    expect(portalSegmentsPage).toContain('@/components/crm/segments/BehavioralRuleEditor')
    expect(portalSegmentsPage).toContain('@/components/crm/segments/EngagementRuleEditor')
    expect(portalSegmentsPage).not.toContain('@/components/admin/segments/')

    expect(behavioralEditor).toContain('export function BehavioralRuleEditor')
    expect(engagementEditor).toContain('export function EngagementRuleEditor')
  })
})
