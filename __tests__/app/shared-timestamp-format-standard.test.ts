import { existsSync, readFileSync } from 'fs'
import path from 'path'

const repoRoot = process.cwd()

function source(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

describe('shared timestamp format standard', () => {
  it('keeps cross-surface timestamp formatting out of admin-owned email components', () => {
    const sharedFormatterPath = path.join(repoRoot, 'lib/format/timestamp.ts')
    const oldAdminFormatterPath = path.join(repoRoot, 'components/admin/email/fmtTimestamp.ts')
    const sharedImport = '@/lib/format/timestamp'
    const adminImport = '@/components/admin/email/fmtTimestamp'

    expect(existsSync(sharedFormatterPath)).toBe(true)
    expect(existsSync(oldAdminFormatterPath)).toBe(false)
    expect(source('lib/format/timestamp.ts')).toContain('export function fmtTimestamp')

    const consumers = [
      'app/(admin)/admin/crm/contacts/[id]/page.tsx',
      'app/(portal)/portal/contacts/[id]/page.tsx',
      'app/(portal)/portal/dashboard/page.tsx',
      'app/(portal)/portal/deals/[id]/page.tsx',
      'components/admin/email/EmailDetail.tsx',
      'components/admin/email/EmailList.tsx',
      'components/capture-sources/CaptureSourcesWorkspace.tsx',
      'components/crm/ContactsWorkspace.tsx',
      'components/crm/NotificationBell.tsx',
      'components/integrations/IntegrationsWorkspace.tsx',
    ]

    for (const consumer of consumers) {
      const consumerSource = source(consumer)
      expect(consumerSource).toContain(sharedImport)
      expect(consumerSource).not.toContain(adminImport)
      expect(consumerSource).not.toContain('./fmtTimestamp')
    }
  })
})
