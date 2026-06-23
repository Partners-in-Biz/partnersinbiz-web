import { existsSync, readFileSync } from 'fs'
import path from 'path'

const root = process.cwd()

function source(relativePath: string) {
  return readFileSync(path.join(root, relativePath), 'utf8')
}

const REQUIRED_PAGE_FILES = [
  'app/(admin)/admin/properties/page.tsx',
  'app/(admin)/admin/products/page.tsx',
  'app/(admin)/admin/hermes/page.tsx',
  'app/(admin)/admin/moderation/page.tsx',
  'app/(admin)/admin/system/wiki-sync/page.tsx',
  'app/(admin)/admin/system/audit-log/page.tsx',
  'app/(admin)/admin/domains/page.tsx',
  'app/(admin)/admin/domains/ssl/page.tsx',
  'app/(admin)/admin/ab-tests/page.tsx',
  'app/(admin)/admin/ab-tests/[testId]/page.tsx',
  'app/(admin)/admin/analytics/ingestion/page.tsx',
  'app/(admin)/admin/analytics/scrolledbrain/page.tsx',
  'app/(admin)/admin/reports/templates/page.tsx',
  'app/(admin)/admin/settings/social-credentials/page.tsx',
  'app/(admin)/admin/tools/import/page.tsx',
  'app/(admin)/admin/announcements/page.tsx',
  'app/(admin)/admin/changelog/page.tsx',
  'app/(admin)/admin/2fa/page.tsx',
  'app/(portal)/portal/billing/page.tsx',
]

describe('admin backlog surfaces contract', () => {
  it('ships concrete operator pages for the audited backlog routes', () => {
    for (const relativePath of REQUIRED_PAGE_FILES) {
      expect(existsSync(path.join(root, relativePath))).toBe(true)
    }
  })

  it('keeps the backlog pages as bounded admin surfaces instead of redirect-only fallbacks', () => {
    for (const relativePath of REQUIRED_PAGE_FILES) {
      const text = source(relativePath)

      expect(text).not.toContain("redirect('/admin/dashboard')")
      expect(text).not.toContain("redirect('/admin/settings')")
      expect(text).not.toContain("redirect('/admin/updates')")
      expect(text).not.toContain("redirect('/portal/")
    }
  })

  it('mounts an admin 2FA gate in the admin layout and keeps a dedicated admin 2FA route', () => {
    const layout = source('app/(admin)/layout.tsx')
    const page = source('app/(admin)/admin/2fa/page.tsx')

    expect(layout).toContain('AdminTwoFactorGate')
    expect(page).toContain('Two-factor authentication')
    expect(page).toContain('/api/v1/account/2fa/status')
  })
})
