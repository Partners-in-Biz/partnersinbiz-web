import { existsSync, readFileSync } from 'fs'
import path from 'path'

const root = process.cwd()

function source(relativePath: string) {
  return readFileSync(path.join(root, relativePath), 'utf8')
}

const REQUIRED_API_FILES = [
  'app/api/v1/admin/properties/route.ts',
  'app/api/v1/admin/products/route.ts',
  'app/api/v1/admin/hermes/route.ts',
  'app/api/v1/admin/moderation/route.ts',
  'app/api/v1/admin/system/wiki-sync/route.ts',
  'app/api/v1/admin/audit-log/route.ts',
  'app/api/v1/admin/domains/route.ts',
  'app/api/v1/admin/domains/ssl/route.ts',
  'app/api/v1/admin/ab-tests/route.ts',
  'app/api/v1/admin/ab-tests/[testId]/route.ts',
  'app/api/v1/admin/analytics/ingestion/route.ts',
  'app/api/v1/admin/analytics/scrolledbrain/route.ts',
  'app/api/v1/admin/reports/templates/route.ts',
  'app/api/v1/admin/social-credentials/route.ts',
  'app/api/v1/admin/tools/import/route.ts',
  'app/api/v1/admin/announcements/route.ts',
  'app/api/v1/admin/changelog/route.ts',
]

describe('admin backlog api contract', () => {
  it('ships dedicated admin api routes for the backlog surfaces', () => {
    for (const relativePath of REQUIRED_API_FILES) {
      expect(existsSync(path.join(root, relativePath))).toBe(true)
    }
  })

  it('protects the backlog api routes with admin auth rather than portal redirects', () => {
    for (const relativePath of REQUIRED_API_FILES) {
      const text = source(relativePath)

      expect(text).toContain("withAuth('admin'")
      expect(text).not.toContain('redirect(')
    }
  })
})
